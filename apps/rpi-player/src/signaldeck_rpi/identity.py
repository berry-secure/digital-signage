from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import os
import re
import uuid

from .config import OutputConfig


@dataclass(frozen=True)
class OutputIdentity:
    serial: str
    secret: str


@dataclass(frozen=True)
class PlayerIdentity:
    base_serial: str
    outputs: dict[str, OutputIdentity]


def normalize_serial(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def derive_base_serial(cpuinfo: str, machine_id: str, fallback_uuid: str) -> str:
    cpu_serial = _read_cpu_serial(cpuinfo)
    if cpu_serial:
        normalized = normalize_serial(cpu_serial).lstrip("0") or normalize_serial(cpu_serial)
        return f"MK{normalized[-12:]}"

    machine = normalize_serial(machine_id)
    if machine:
        return f"MK{machine[:12]}"

    fallback = normalize_serial(fallback_uuid)
    return f"MK{fallback[:12]}"


def load_or_create_identity(path: str | Path, base_serial: str, outputs: list[OutputConfig]) -> PlayerIdentity:
    identity_path = Path(path)
    if identity_path.exists():
        return _identity_from_dict(json.loads(identity_path.read_text(encoding="utf-8")))

    normalized_base = normalize_serial(base_serial)
    if not normalized_base:
        raise ValueError("base serial cannot be empty")

    identity = PlayerIdentity(
        base_serial=normalized_base,
        outputs={
            output.name: OutputIdentity(
                serial=f"{normalized_base}{normalize_serial(output.serial_suffix)}",
                secret=uuid.uuid4().hex,
            )
            for output in outputs
            if output.enabled
        },
    )
    _write_identity(identity_path, identity)
    return identity


def load_or_create_system_identity(
    path: str | Path,
    outputs: list[OutputConfig],
    cpuinfo_path: str | Path = "/proc/cpuinfo",
    machine_id_path: str | Path = "/etc/machine-id",
) -> PlayerIdentity:
    cpuinfo = _read_text(cpuinfo_path)
    machine_id = _read_text(machine_id_path)
    base_serial = derive_base_serial(cpuinfo, machine_id, uuid.uuid4().hex)
    return load_or_create_identity(path, base_serial, outputs)


def _read_cpu_serial(cpuinfo: str) -> str:
    for line in cpuinfo.splitlines():
        if line.lower().startswith("serial"):
            _, _, value = line.partition(":")
            return value.strip()
    return ""


def _identity_from_dict(data: dict[str, Any]) -> PlayerIdentity:
    base_serial = normalize_serial(str(data.get("baseSerial") or data.get("base_serial") or ""))
    outputs_data = data.get("outputs") if isinstance(data.get("outputs"), dict) else {}
    outputs = {
        str(name): OutputIdentity(
            serial=normalize_serial(str(value.get("serial") or "")),
            secret=str(value.get("secret") or ""),
        )
        for name, value in outputs_data.items()
        if isinstance(value, dict)
    }
    return PlayerIdentity(base_serial=base_serial, outputs=outputs)


def _write_identity(path: Path, identity: PlayerIdentity) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "baseSerial": identity.base_serial,
        "outputs": {
            name: {"serial": output.serial, "secret": output.secret}
            for name, output in identity.outputs.items()
        },
    }
    temporary = path.with_suffix(f"{path.suffix}.partial")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)


def _read_text(path: str | Path) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
