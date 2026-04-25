from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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
    if command_type in GLOBAL_COMMANDS:
        return CommandAction("global", command_type, "acked", f"{command_type} accepted")
    if command_type in OUTPUT_COMMANDS:
        return CommandAction("output", command_type, "acked", f"{command_type} accepted")
    return CommandAction("output", "unsupported", "failed", f"command {command_type or 'unknown'} is not supported by rpi player v1")
