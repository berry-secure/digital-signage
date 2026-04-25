from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import logging
import os
import socket
import time

from .cache import MediaCache
from .cms import CmsClient
from .commands import route_command
from .config import PlayerConfig, load_config
from .identity import PlayerIdentity, load_or_create_system_identity
from .playback import MvpProcessController, build_mpv_playlist_command, playback_decision

LOGGER = logging.getLogger("signaldeck.agent")


@dataclass
class OutputState:
    approval_status: str = "pending"
    desired_display_state: str = "active"
    active_item_title: str = ""
    last_sync_at: str = ""
    last_message: str = ""
    current_item_id: str = ""


@dataclass
class AgentRuntime:
    config: PlayerConfig
    identity: PlayerIdentity
    cms: CmsClient
    cache: MediaCache
    playback_controller: Any = field(default_factory=MvpProcessController)
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
            self._sync_playback(output, output_identity.serial, output_identity.secret, queue)

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

    def _sync_playback(self, output: str, serial: str, secret: str, queue: list[dict[str, Any]]) -> None:
        state = self.states.setdefault(output, OutputState())
        if state.desired_display_state == "blackout":
            self.playback_controller.stop(output)
            state.current_item_id = ""
            return

        playable_items = _playable_items(queue)
        if not playable_items:
            self.playback_controller.stop(output)
            state.current_item_id = ""
            return

        queue_id = _queue_signature(playable_items)
        if state.current_item_id == queue_id and self.playback_controller.is_running(output):
            return

        try:
            media_paths = [self.cache.download(output, item) for item in playable_items]
            command = build_mpv_playlist_command(
                media_paths,
                output,
                playable_items[0].get("volumePercent") or 100,
                _first_image_duration(playable_items),
            )
            self.playback_controller.play(output, command)
            state.current_item_id = queue_id
            LOGGER.info("started playback on %s with %s queued item(s)", output, len(playable_items))
        except Exception as error:
            LOGGER.error("failed to start playback on %s: %s", output, error)
            self._log(serial, secret, "error", "playback", f"failed to start playback on {output}: {error}", {"output": output, "queue": playable_items})

    def _log(self, serial: str, secret: str, severity: str, component: str, message: str, context: dict[str, Any]) -> None:
        try:
            self.cms.post_log(
                serial,
                secret,
                severity,
                component,
                message,
                context=context,
                app_version=self.config.app_version,
                network_status="online",
            )
        except Exception:
            LOGGER.debug("failed to post CMS log", exc_info=True)


def create_runtime(
    config_path: str | Path = "/etc/signaldeck/player.toml",
    identity_path: str | Path = "/var/lib/signaldeck/identity.json",
    state_root: str | Path = "/var/lib/signaldeck",
) -> AgentRuntime:
    config = load_config(config_path)
    identity = load_or_create_system_identity(identity_path, config.outputs)
    return AgentRuntime(config, identity, CmsClient(config.server_url), MediaCache(state_root, config.cache_limit_mb))


def run_forever(runtime: AgentRuntime) -> None:
    notify_systemd("READY=1")
    while True:
        runtime.poll_once()
        notify_systemd("WATCHDOG=1")
        time.sleep(max(runtime.config.heartbeat_interval_seconds, 1))


def notify_systemd(message: str) -> None:
    address = os.environ.get("NOTIFY_SOCKET")
    if not address:
        return
    if address.startswith("@"):
        address = "\0" + address[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
            client.connect(address)
            client.sendall(message.encode("utf-8"))
    except OSError:
        LOGGER.debug("systemd notify failed", exc_info=True)


def _queue_from_response(response: dict[str, Any]) -> list[dict[str, Any]]:
    playback = response.get("playback") if isinstance(response.get("playback"), dict) else {}
    queue = playback.get("queue")
    return queue if isinstance(queue, list) else []


def _playable_items(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in queue if playback_decision(item).action == "play"]


def _queue_signature(queue: list[dict[str, Any]]) -> str:
    return "|".join(str(item.get("id") or item.get("url") or index) for index, item in enumerate(queue))


def _first_image_duration(queue: list[dict[str, Any]]) -> int | float:
    for item in queue:
        if str(item.get("kind") or "").lower() == "image":
            return item.get("durationSeconds") or 10
    return 10
