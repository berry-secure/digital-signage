from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class CommandAction:
    scope: str
    effect: str
    ack_status: str
    message: str


GLOBAL_COMMANDS = {
    "restart_app",
    "reboot_os",
    "clear_cache",
    "upload_logs",
    "set_server_url",
}

OUTPUT_COMMANDS = {
    "force_sync",
    "force_playlist_update",
    "blackout",
    "wake",
    "set_volume",
}


def route_command(command: dict[str, Any]) -> CommandAction:
    command_type = str(command.get("type") or "")
    if command_type == "set_server_url":
        server_url = server_url_from_command(command)
        if not _is_https_url(server_url):
            return CommandAction("global", command_type, "failed", "set_server_url requires an https serverUrl")
        return CommandAction("global", command_type, "acked", "set_server_url accepted")
    if command_type in GLOBAL_COMMANDS:
        return CommandAction("global", command_type, "acked", f"{command_type} accepted")
    if command_type in OUTPUT_COMMANDS:
        return CommandAction("output", command_type, "acked", f"{command_type} accepted")
    return CommandAction("output", "unsupported", "failed", f"command {command_type or 'unknown'} is not supported by rpi player v1")


def server_url_from_command(command: dict[str, Any]) -> str:
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    return str(payload.get("serverUrl") or payload.get("server_url") or "").strip().rstrip("/")


def _is_https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)
