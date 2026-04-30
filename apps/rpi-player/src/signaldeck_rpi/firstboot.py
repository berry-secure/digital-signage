from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import argparse
import os
import secrets
import string
import subprocess


HOTSPOT_CONNECTION = "SignalDeck-Setup"
DEFAULT_WEBUI_PASSWORD = "Maasck23646"


class FirstBootProvisioner:
    def __init__(
        self,
        config_dir: str | Path = "/etc/signaldeck",
        state_root: str | Path = "/var/lib/signaldeck",
        boot_dir: str | Path = "/boot/firmware",
        hotspot_connection: str = HOTSPOT_CONNECTION,
        runner: Callable[[list[str], bool], object] | None = None,
        random_suffix: Callable[[], str] | None = None,
        random_password: Callable[[], str] | None = None,
    ):
        self.config_dir = Path(config_dir)
        self.state_root = Path(state_root)
        self.boot_dir = Path(boot_dir)
        self.hotspot_connection = hotspot_connection
        self.runner = runner or _run
        self.random_suffix = random_suffix or _random_suffix
        self.random_password = random_password or _random_password

    def run(self, webui_password: str = DEFAULT_WEBUI_PASSWORD) -> bool:
        done_marker = self.state_root / "firstboot.done"
        if done_marker.exists():
            return False

        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.state_root.mkdir(parents=True, exist_ok=True)
        self.boot_dir.mkdir(parents=True, exist_ok=True)

        ssid = f"SignalDeck-{self.random_suffix()}"
        hotspot_password = self.random_password()

        self._write_secret(self.config_dir / "webui.secret", webui_password)
        self._write_secret(self.config_dir / "hotspot.secret", hotspot_password)
        (self.state_root / "identity.json").unlink(missing_ok=True)
        (self.boot_dir / "SIGNALDECK_LOCK").unlink(missing_ok=True)
        self._clear_runtime_dirs()
        self._configure_hotspot(ssid, hotspot_password)
        self._write_handoff(ssid, hotspot_password, webui_password)
        done_marker.write_text("done\n", encoding="utf-8")
        os.chmod(done_marker, 0o600)
        self.runner(["systemctl", "disable", "signaldeck-firstboot.service"], True)
        return True

    def _configure_hotspot(self, ssid: str, password: str) -> None:
        self.runner(["nmcli", "connection", "add", "type", "wifi", "ifname", "wlan0", "con-name", self.hotspot_connection, "ssid", ssid], True)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "connection.autoconnect", "no"], False)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "802-11-wireless.mode", "ap"], False)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "802-11-wireless.band", "bg"], False)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "802-11-wireless.ssid", ssid], False)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "ipv4.method", "shared"], False)
        self.runner(["nmcli", "connection", "modify", self.hotspot_connection, "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password], False)

    def _write_handoff(self, ssid: str, hotspot_password: str, webui_password: str) -> None:
        (self.boot_dir / "SIGNALDECK_HOTSPOT.txt").write_text(
            "\n".join(
                [
                    "Signal Deck first boot credentials",
                    f"Hotspot SSID: {ssid}",
                    f"Hotspot password: {hotspot_password}",
                    "WebUI URL: http://10.42.0.1:8080",
                    "WebUI login: admin",
                    f"WebUI password: {webui_password}",
                    "SSH login: admin",
                    f"SSH password: {webui_password}",
                    "",
                ]
            ),
            encoding="utf-8",
        )

    def _write_secret(self, path: Path, value: str) -> None:
        path.write_text(f"{value}\n", encoding="utf-8")
        os.chmod(path, 0o600)

    def _clear_runtime_dirs(self) -> None:
        for dirname in ("cache", "manifests", "proof-of-play", "queue"):
            directory = self.state_root / dirname
            if not directory.exists():
                continue
            for path in directory.rglob("*"):
                if path.is_file() or path.is_symlink():
                    path.unlink(missing_ok=True)


def _random_suffix() -> str:
    return secrets.token_hex(3).upper()


def _random_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(18))


def _run(command: list[str], allow_failure: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 and not allow_failure:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(f"{' '.join(command)}: {detail}")
    return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-dir", default="/etc/signaldeck")
    parser.add_argument("--state-root", default="/var/lib/signaldeck")
    parser.add_argument("--boot-dir", default="/boot/firmware")
    parser.add_argument("--webui-password", default=DEFAULT_WEBUI_PASSWORD)
    args = parser.parse_args(argv)
    FirstBootProvisioner(args.config_dir, args.state_root, args.boot_dir).run(args.webui_password)
