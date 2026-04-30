from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import tomllib

DEFAULT_SERVER_URL = "https://maask-ds.online"


@dataclass(frozen=True)
class OutputConfig:
    name: str
    serial_suffix: str
    enabled: bool = True


@dataclass(frozen=True)
class SyncConfig:
    mode: str = "independent"
    group: str = "dual-hdmi"
    policy: str = "best_effort"
    tolerance_ms: int = 250
    group_blackout: bool = True


@dataclass(frozen=True)
class PlayerConfig:
    server_url: str = DEFAULT_SERVER_URL
    device_model: str = "Raspberry Pi 5"
    player_type: str = "video_premium"
    app_version: str = "rpi-video-premium-0.1.0"
    cache_limit_mb: int = 20480
    heartbeat_interval_seconds: int = 15
    sync: SyncConfig = field(default_factory=SyncConfig)
    outputs: list[OutputConfig] = field(default_factory=list)


def default_outputs() -> list[OutputConfig]:
    return [OutputConfig("HDMI-A-1", "A", True), OutputConfig("HDMI-A-2", "B", True)]


def default_config() -> PlayerConfig:
    return PlayerConfig(outputs=default_outputs())


def load_config(path: str | Path) -> PlayerConfig:
    config_path = Path(path)
    if not config_path.exists():
        return default_config()

    data = tomllib.loads(config_path.read_text(encoding="utf-8"))
    defaults = default_config()
    sync_data = _table(data.get("sync"))
    outputs_data = data.get("outputs") if isinstance(data.get("outputs"), list) else []

    outputs = [
        OutputConfig(
            name=str(item.get("name") or "").strip(),
            serial_suffix=str(item.get("serial_suffix") or "").strip().upper(),
            enabled=bool(item.get("enabled", True)),
        )
        for item in outputs_data
        if isinstance(item, dict) and str(item.get("name") or "").strip()
    ]

    return PlayerConfig(
        server_url=str(data.get("server_url") or defaults.server_url).strip().rstrip("/"),
        device_model=str(data.get("device_model") or defaults.device_model).strip(),
        player_type=str(data.get("player_type") or defaults.player_type).strip(),
        app_version=str(data.get("app_version") or defaults.app_version).strip(),
        cache_limit_mb=_int(data.get("cache_limit_mb"), defaults.cache_limit_mb),
        heartbeat_interval_seconds=_int(data.get("heartbeat_interval_seconds"), defaults.heartbeat_interval_seconds),
        sync=SyncConfig(
            mode=str(sync_data.get("mode") or defaults.sync.mode).strip(),
            group=str(sync_data.get("group") or defaults.sync.group).strip(),
            policy=str(sync_data.get("policy") or defaults.sync.policy).strip(),
            tolerance_ms=_int(sync_data.get("tolerance_ms"), defaults.sync.tolerance_ms),
            group_blackout=bool(sync_data.get("group_blackout", defaults.sync.group_blackout)),
        ),
        outputs=outputs or defaults.outputs,
    )


def default_config_toml() -> str:
    return render_config_toml(default_config())


def render_config_toml(
    config: PlayerConfig,
    server_url: str | None = None,
    sync_mode: str | None = None,
    sync_policy: str | None = None,
    tolerance_ms: int | None = None,
) -> str:
    outputs = "\n".join(
        f'\n[[outputs]]\nname = "{output.name}"\nserial_suffix = "{output.serial_suffix}"\nenabled = {"true" if output.enabled else "false"}\n'
        for output in config.outputs
    )
    return f'''server_url = "{(server_url or config.server_url).strip().rstrip("/")}"
device_model = "{config.device_model}"
player_type = "{config.player_type}"
app_version = "{config.app_version}"
cache_limit_mb = {config.cache_limit_mb}
heartbeat_interval_seconds = {config.heartbeat_interval_seconds}

[sync]
mode = "{sync_mode or config.sync.mode}"
group = "{config.sync.group}"
policy = "{sync_policy or config.sync.policy}"
tolerance_ms = {max(tolerance_ms if tolerance_ms is not None else config.sync.tolerance_ms, 0)}
group_blackout = {"true" if config.sync.group_blackout else "false"}
{outputs}'''


def write_default_config(path: str | Path) -> bool:
    config_path = Path(path)
    if config_path.exists():
        return False
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(default_config_toml(), encoding="utf-8")
    config_path.chmod(0o600)
    return True


def _table(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback
