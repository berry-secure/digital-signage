from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import logging
import time

from .cache import MediaCache
from .cms import CmsClient
from .commands import route_command
from .config import PlayerConfig, load_config
from .identity import PlayerIdentity, load_or_create_system_identity

LOGGER = logging.getLogger("signaldeck.agent")


@dataclass
class OutputState:
    approval_status: str = "pending"
    desired_display_state: str = "active"
    active_item_title: str = ""
    last_sync_at: str = ""
    last_message: str = ""


@dataclass
class AgentRuntime:
    config: PlayerConfig
    identity: PlayerIdentity
    cms: CmsClient
    cache: MediaCache
    states: dict[str, OutputState] = field(default_factory=dict)

    def build_session_payloads(self, player_state: str = "idle", active_item_title: str = "") -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        for output in self.config.outputs:
            if not output.enabled or output.name not in self.identity.outputs:
                continue
            output_identity = self.identity.outputs[output.name]
            state = self.states.setdefault(output.name, OutputState())
            title = active_item_title or state.active_item_title
            payloads.append(
                {
                    "serial": output_identity.serial,
                    "secret": output_identity.secret,
                    "platform": "raspberrypi",
                    "appVersion": self.config.app_version,
                    "deviceModel": self.config.device_model,
                    "playerType": self.config.player_type,
                    "playerState": player_state,
                    "playerMessage": f"{output.name} {player_state}",
                    "activeItemTitle": title,
                }
            )
        return payloads

    def poll_once(self) -> list[dict[str, Any]]:
        responses: list[dict[str, Any]] = []
        for output, payload in zip(self.enabled_output_names(), self.build_session_payloads()):
            output_identity = self.identity.outputs[output]
            try:
                response = self.cms.post_session(payload)
            except Exception as error:
                LOGGER.warning("session poll failed for %s: %s", output, error)
                continue

            responses.append(response)
            self._update_state(output, response)
            queue = _queue_from_response(response)
            if queue:
                self.cache.write_manifest(output, queue)

            for command in response.get("commands") or []:
                action = route_command(command)
                self.cms.ack_command(
                    str(command.get("id") or ""),
                    output_identity.serial,
                    output_identity.secret,
                    action.ack_status,
                    action.message,
                )
        return responses

    def enabled_output_names(self) -> list[str]:
        return [
            output.name
            for output in self.config.outputs
            if output.enabled and output.name in self.identity.outputs
        ]

    def _update_state(self, output: str, response: dict[str, Any]) -> None:
        state = self.states.setdefault(output, OutputState())
        device = response.get("device") if isinstance(response.get("device"), dict) else {}
        state.approval_status = str(response.get("approvalStatus") or device.get("approvalStatus") or state.approval_status)
        state.desired_display_state = str(device.get("desiredDisplayState") or state.desired_display_state)
        state.last_sync_at = str(response.get("serverTime") or state.last_sync_at)
        queue = _queue_from_response(response)
        state.active_item_title = str(queue[0].get("title") or "") if queue else ""
        state.last_message = str(response.get("playback", {}).get("reason") or "")


def create_runtime(
    config_path: str | Path = "/etc/signaldeck/player.toml",
    identity_path: str | Path = "/var/lib/signaldeck/identity.json",
    state_root: str | Path = "/var/lib/signaldeck",
) -> AgentRuntime:
    config = load_config(config_path)
    identity = load_or_create_system_identity(identity_path, config.outputs)
    return AgentRuntime(config, identity, CmsClient(config.server_url), MediaCache(state_root, config.cache_limit_mb))


def run_forever(runtime: AgentRuntime) -> None:
    while True:
        runtime.poll_once()
        time.sleep(max(runtime.config.heartbeat_interval_seconds, 1))


def _queue_from_response(response: dict[str, Any]) -> list[dict[str, Any]]:
    playback = response.get("playback") if isinstance(response.get("playback"), dict) else {}
    queue = playback.get("queue")
    return queue if isinstance(queue, list) else []
