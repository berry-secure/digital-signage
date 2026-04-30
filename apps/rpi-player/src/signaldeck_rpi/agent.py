from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
import logging
import os
import socket
import subprocess
import time

from .cache import MediaCache
from .cms import CmsClient
from .commands import CommandAction, route_command, server_url_from_command
from .config import PlayerConfig, load_config, render_config_toml
from .identity import PlayerIdentity, load_or_create_system_identity
from .logs import LogSpool
from .playback import MvpProcessController, build_mpv_playlist_command, playback_decision, probe_drm_connector_states
from .proof import ProofOfPlayReporter

LOGGER = logging.getLogger("signaldeck.agent")


@dataclass
class OutputState:
    approval_status: str = "pending"
    desired_display_state: str = "active"
    device_id: str = ""
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
    proof_reporter: Any | None = None
    log_spool: Any | None = None
    config_path: Path = Path("/etc/signaldeck/player.toml")
    runner: Callable[[list[str], bool], object] | None = None
    states: dict[str, OutputState] = field(default_factory=dict)
    connector_status: dict[str, bool] | None = None

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
                    "platform": "rpi",
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
        connected = False
        for output, payload in zip(self.enabled_output_names(), self.build_session_payloads()):
            output_identity = self.identity.outputs[output]
            try:
                response = self.cms.post_session(payload)
            except Exception as error:
                LOGGER.warning("session poll failed for %s: %s", output, error)
                self._sync_cached_playback(output, output_identity.serial, output_identity.secret)
                continue

            connected = True
            responses.append(response)
            self._update_state(output, response)
            queue = _queue_from_response(response)
            self._sync_playback(output, output_identity.serial, output_identity.secret, queue)

            for command in response.get("commands") or []:
                action = route_command(command)
                command_id = str(command.get("id") or "")
                try:
                    self.cms.ack_command(
                        command_id,
                        output_identity.serial,
                        output_identity.secret,
                        action.ack_status,
                        action.message,
                    )
                except Exception as error:
                    message = f"failed to ack command {command_id}: {error}"
                    LOGGER.warning(message)
                    self._log(output_identity.serial, output_identity.secret, "warn", "command", message, {"command": command})
                    continue
                if action.ack_status != "acked":
                    continue
                try:
                    self._apply_command(action, command)
                except Exception as error:
                    message = f"failed to apply command {command_id}: {error}"
                    LOGGER.warning(message)
                    self._log(output_identity.serial, output_identity.secret, "warn", "command", message, {"command": command})
        if connected:
            self._flush_pending(max_items=20)
        return responses

    def enabled_output_names(self) -> list[str]:
        return [
            output.name
            for output in self.config.outputs
            if output.enabled and output.name in self.identity.outputs
        ]

    def start_cached_playback(self) -> None:
        for output in self.enabled_output_names():
            output_identity = self.identity.outputs[output]
            self._sync_cached_playback(output, output_identity.serial, output_identity.secret)

    def _update_state(self, output: str, response: dict[str, Any]) -> None:
        state = self.states.setdefault(output, OutputState())
        device = response.get("device") if isinstance(response.get("device"), dict) else {}
        state.device_id = str(device.get("id") or state.device_id)
        state.approval_status = str(response.get("approvalStatus") or device.get("approvalStatus") or state.approval_status)
        state.desired_display_state = str(device.get("desiredDisplayState") or state.desired_display_state)
        state.last_sync_at = str(response.get("serverTime") or state.last_sync_at)
        queue = _queue_from_response(response)
        state.active_item_title = str(queue[0].get("title") or "") if queue else ""
        state.last_message = str(response.get("playback", {}).get("reason") or "")

    def _sync_playback(self, output: str, serial: str, secret: str, queue: list[dict[str, Any]], allow_download: bool = True) -> None:
        state = self.states.setdefault(output, OutputState())
        if not self._is_output_connected(output):
            self.playback_controller.stop(output)
            self._stop_proof(output)
            state.current_item_id = ""
            self._log(serial, secret, "warn", "display", f"{output} is disconnected; playback paused", {"output": output})
            return

        if state.desired_display_state == "blackout":
            self.playback_controller.stop(output)
            self._stop_proof(output)
            state.current_item_id = ""
            return

        playable_items = _playable_items(queue)
        if not playable_items:
            if allow_download:
                self.playback_controller.stop(output)
                self._stop_proof(output)
                state.current_item_id = ""
            return

        try:
            media_entries = self._prepare_media(output, playable_items, allow_download)
            ready_items = [item for item, _path in media_entries]
            if not ready_items:
                if allow_download:
                    raise RuntimeError(f"no playable cached media for {output}")
                return

            queue_id = _queue_signature(ready_items)
            if state.current_item_id == queue_id and self.playback_controller.is_running(output):
                return

            command = build_mpv_playlist_command(
                [path for _item, path in media_entries],
                output,
                ready_items[0].get("volumePercent") or 100,
                _first_image_duration(ready_items),
            )
            if allow_download:
                self.cache.write_manifest(output, playable_items)
            self.playback_controller.play(output, command)
            self._start_proof(output, serial, secret, state.device_id, ready_items)
            state.current_item_id = queue_id
            LOGGER.info("started playback on %s with %s queued item(s)", output, len(ready_items))
        except Exception as error:
            LOGGER.error("failed to start playback on %s: %s", output, error)
            self._log(serial, secret, "error", "playback", f"failed to start playback on {output}: {error}", {"output": output, "queue": playable_items})

    def _sync_cached_playback(self, output: str, serial: str, secret: str) -> None:
        queue = self.cache.read_manifest(output)
        if not queue:
            return
        self.states.setdefault(output, OutputState()).last_message = "Offline, playing cached playlist"
        self._sync_playback(output, serial, secret, queue, allow_download=False)

    def _prepare_media(self, output: str, items: list[dict[str, Any]], allow_download: bool) -> list[tuple[dict[str, Any], Path]]:
        media_entries: list[tuple[dict[str, Any], Path]] = []
        for item in items:
            if allow_download:
                media_entries.append((item, self.cache.download(output, item)))
                continue
            path = self.cache.cached_path(output, item)
            if path is not None:
                media_entries.append((item, path))
        return media_entries

    def _log(self, serial: str, secret: str, severity: str, component: str, message: str, context: dict[str, Any]) -> None:
        payload = _build_log_payload(
            serial,
            secret,
            severity,
            component,
            message,
            context,
            self.config.app_version,
            "online",
        )
        try:
            self.cms.post_log_payload(payload)
        except Exception:
            LOGGER.debug("failed to post CMS log", exc_info=True)
            if self.log_spool:
                self.log_spool.enqueue(payload)

    def _is_output_connected(self, output: str) -> bool:
        if self.connector_status is not None:
            return self.connector_status.get(output, False)
        states = probe_drm_connector_states()
        connector = states.get(output)
        return True if connector is None else connector.connected

    def _start_proof(self, output: str, serial: str, secret: str, device_id: str, queue: list[dict[str, Any]]) -> None:
        if not self.proof_reporter:
            return
        self.proof_reporter.start_output(
            output,
            serial,
            secret,
            device_id,
            queue,
            lambda output_name=output: self.playback_controller.is_running(output_name),
        )

    def _stop_proof(self, output: str) -> None:
        if self.proof_reporter:
            self.proof_reporter.stop_output(output)

    def _apply_command(self, action: CommandAction, command: dict[str, Any]) -> None:
        if action.effect != "set_server_url":
            return
        server_url = server_url_from_command(command)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(render_config_toml(self.config, server_url=server_url), encoding="utf-8")
        self.config_path.chmod(0o640)
        self.config = load_config(self.config_path)
        self._run(["bash", "-lc", "(sleep 1; systemctl restart signaldeck-agent.service) >/dev/null 2>&1 &"], True)

    def _run(self, command: list[str], allow_failure: bool = False) -> object:
        return (self.runner or _run)(command, allow_failure)

    def _flush_pending(self, max_items: int | None = None) -> None:
        if self.proof_reporter:
            self.proof_reporter.flush_pending(max_items=max_items)
        if self.log_spool:
            self.log_spool.flush(self.cms.post_log_payload, max_items=max_items)


def create_runtime(
    config_path: str | Path = "/etc/signaldeck/player.toml",
    identity_path: str | Path = "/var/lib/signaldeck/identity.json",
    state_root: str | Path = "/var/lib/signaldeck",
) -> AgentRuntime:
    config = load_config(config_path)
    LOGGER.info("starting Signal Deck RPi player server_url=%s", config.server_url)
    identity = load_or_create_system_identity(identity_path, config.outputs)
    cms = CmsClient(config.server_url)
    cache = MediaCache(state_root, config.cache_limit_mb)
    proof_reporter = ProofOfPlayReporter(cms, Path(state_root) / "proof-of-play", config.app_version)
    log_spool = LogSpool(Path(state_root) / "queue" / "logs")
    return AgentRuntime(config, identity, cms, cache, proof_reporter=proof_reporter, log_spool=log_spool, config_path=Path(config_path))


def run_forever(runtime: AgentRuntime) -> None:
    notify_systemd("READY=1")
    runtime.start_cached_playback()
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


def _build_log_payload(
    serial: str,
    secret: str,
    severity: str,
    component: str,
    message: str,
    context: dict[str, Any],
    app_version: str,
    network_status: str,
) -> dict[str, Any]:
    return {
        "serial": serial,
        "secret": secret,
        "severity": severity,
        "component": component,
        "message": message,
        "stack": "",
        "context": context,
        "appVersion": app_version,
        "osVersion": "",
        "networkStatus": network_status,
    }


def _run(command: list[str], allow_failure: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 and not allow_failure:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(f"{' '.join(command)}: {detail}")
    return result
