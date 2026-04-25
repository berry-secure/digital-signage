from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import subprocess


@dataclass(frozen=True)
class PlaybackDecision:
    action: str
    severity: str
    message: str


@dataclass(frozen=True)
class DrmConnectorState:
    name: str
    sysfs_name: str
    status: str

    @property
    def connected(self) -> bool:
        return self.status == "connected"


def playback_decision(item: dict[str, Any]) -> PlaybackDecision:
    kind = str(item.get("kind") or "").lower()
    if kind == "audio":
        return PlaybackDecision("skip", "warn", "audio items are not supported by Video Premium v1")
    if kind in {"video", "image"}:
        return PlaybackDecision("play", "info", f"play {kind}")
    return PlaybackDecision("skip", "warn", f"unsupported playback kind: {kind or 'unknown'}")


def build_mpv_command(
    media_path: str | Path,
    connector: str,
    kind: str,
    duration_seconds: int | float,
    volume_percent: int | float,
) -> list[str]:
    command = [
        "mpv",
        "--no-terminal",
        "--really-quiet",
        "--fs",
        "--force-window=immediate",
        "--loop-playlist=inf",
        "--vo=drm",
        f"--drm-connector={connector}",
        f"--volume={_clamp_int(volume_percent, 0, 100)}",
    ]
    if kind == "image":
        command.extend(["--loop-file=no", f"--image-display-duration={max(int(duration_seconds or 10), 1)}", "--no-audio"])
    command.append(str(media_path))
    return command


def build_mpv_playlist_command(
    media_paths: list[str | Path],
    connector: str,
    volume_percent: int | float,
    image_duration_seconds: int | float = 10,
) -> list[str]:
    command = [
        "mpv",
        "--no-terminal",
        "--really-quiet",
        "--fs",
        "--force-window=immediate",
        "--loop-playlist=inf",
        "--keep-open=yes",
        "--vo=drm",
        f"--drm-connector={connector}",
        f"--volume={_clamp_int(volume_percent, 0, 100)}",
        f"--image-display-duration={max(int(image_duration_seconds or 10), 1)}",
    ]
    command.extend(str(path) for path in media_paths)
    return command


def probe_drm_connectors(sys_class_drm: str | Path = "/sys/class/drm") -> dict[str, str]:
    return {name: state.sysfs_name for name, state in probe_drm_connector_states(sys_class_drm).items()}


def probe_drm_connector_states(sys_class_drm: str | Path = "/sys/class/drm") -> dict[str, DrmConnectorState]:
    root = Path(sys_class_drm)
    connectors: dict[str, DrmConnectorState] = {}
    if not root.exists():
        return connectors

    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        for suffix in ("HDMI-A-1", "HDMI-A-2"):
            if entry.name.endswith(suffix):
                connectors[suffix] = DrmConnectorState(suffix, entry.name, _read_connector_status(entry))
    return connectors


class MvpProcessController:
    def __init__(self):
        self.processes: dict[str, subprocess.Popen] = {}

    def play(self, output: str, command: list[str]) -> None:
        self.stop(output)
        self.processes[output] = subprocess.Popen(command)

    def stop(self, output: str) -> None:
        process = self.processes.pop(output, None)
        if process and process.poll() is None:
            process.terminate()

    def stop_all(self) -> None:
        for output in list(self.processes):
            self.stop(output)

    def is_running(self, output: str) -> bool:
        process = self.processes.get(output)
        return bool(process and process.poll() is None)


def _clamp_int(value: int | float, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = minimum
    return max(minimum, min(maximum, number))


def _read_connector_status(path: Path) -> str:
    status_path = path / "status"
    if not status_path.exists():
        return "unknown"
    try:
        return status_path.read_text(encoding="utf-8").strip() or "unknown"
    except OSError:
        return "unknown"
