from __future__ import annotations

from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import argparse
import html
import json
import os
import shlex
import shutil
import socket
import subprocess
from urllib.parse import parse_qs

from .config import PlayerConfig, load_config
from .identity import PlayerIdentity, load_or_create_system_identity
from .playback import probe_drm_connectors


@dataclass
class StatusProvider:
    config: PlayerConfig
    identity: PlayerIdentity
    state_root: Path = Path("/var/lib/signaldeck")
    config_path: Path = Path("/etc/signaldeck/player.toml")
    boot_dir: Path = Path("/boot/firmware")

    def snapshot(self) -> dict[str, Any]:
        connectors = probe_drm_connectors()
        outputs = {}
        for output in self.config.outputs:
            identity = self.identity.outputs.get(output.name)
            outputs[output.name] = {
                "enabled": output.enabled,
                "serial": identity.serial if identity else "",
                "connector": connectors.get(output.name, ""),
                "manifestItems": self._manifest_count(output.name),
            }
        return {
            "baseSerial": self.identity.base_serial,
            "serverUrl": self.config.server_url,
            "appVersion": self.config.app_version,
            "system": self._system_status(),
            "sync": {
                "mode": self.config.sync.mode,
                "group": self.config.sync.group,
                "policy": self.config.sync.policy,
                "toleranceMs": self.config.sync.tolerance_ms,
            },
            "outputs": outputs,
            "setupLock": str(self.boot_dir / "SIGNALDECK_LOCK"),
            "setupLocked": (self.boot_dir / "SIGNALDECK_LOCK").exists(),
        }

    def _manifest_count(self, output: str) -> int:
        path = self.state_root / "manifests" / f"{output}.json"
        if not path.exists():
            return 0
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return 0
        return len(data) if isinstance(data, list) else 0

    def _system_status(self) -> dict[str, Any]:
        disk = shutil.disk_usage(self.state_root if self.state_root.exists() else Path("/"))
        return {
            "hostname": socket.gethostname(),
            "cpuLoad": _cpu_load(),
            "memory": _memory_status(),
            "disk": {
                "totalGb": round(disk.total / 1024**3, 2),
                "usedGb": round(disk.used / 1024**3, 2),
                "freeGb": round(disk.free / 1024**3, 2),
                "usedPercent": round((disk.used / disk.total) * 100, 1) if disk.total else 0,
            },
            "cacheMb": round(_directory_size(self.state_root / "cache") / 1024**2, 1),
            "timezone": _read_timezone(),
            "ipAddresses": _capture(["hostname", "-I"]),
            "agentService": _capture(["systemctl", "is-active", "signaldeck-agent.service"]) or "unknown",
            "webuiService": _capture(["systemctl", "is-active", "signaldeck-webui.service"]) or "unknown",
        }


@dataclass
class WebUiApp:
    provider: StatusProvider

    def render_status_json(self) -> dict[str, Any]:
        return self.provider.snapshot()

    def render_index_html(self) -> str:
        status = self.render_status_json()
        system = status["system"]
        output_rows = "\n".join(
            f"<tr><td>{html.escape(name)}</td><td>{html.escape(value['serial'])}</td><td>{html.escape(str(value['enabled']))}</td><td>{html.escape(value.get('connector') or 'not detected')}</td><td>{html.escape(str(value.get('manifestItems', 0)))}</td></tr>"
            for name, value in status["outputs"].items()
        )
        return f"""<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signal Deck Player</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #111; background: #f7f7f4; }}
    main {{ max-width: 920px; margin: 0 auto; }}
    section {{ margin: 1.5rem 0; padding: 1rem; background: white; border: 1px solid #ddd; }}
    table {{ width: 100%; border-collapse: collapse; background: white; }}
    th, td {{ padding: .75rem; border-bottom: 1px solid #ddd; text-align: left; }}
    code {{ background: #eee; padding: .15rem .3rem; }}
    label {{ display: block; margin: .75rem 0 .25rem; font-weight: 650; }}
    input, select {{ width: min(100%, 36rem); padding: .6rem; font: inherit; }}
    button {{ margin-top: 1rem; padding: .65rem .9rem; font: inherit; font-weight: 700; cursor: pointer; }}
    .row {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }}
    .hint {{ color: #555; }}
    .metric {{ background: #f2f2ee; padding: .75rem; }}
    .actions form {{ display: inline-block; margin: .25rem .5rem .25rem 0; }}
  </style>
</head>
<body>
  <main>
    <h1>Signal Deck Player</h1>
    <p>Base serial: <code>{html.escape(status["baseSerial"])}</code></p>
    <p>Server: <code>{html.escape(status["serverUrl"])}</code></p>
    <p>Sync: <code>{html.escape(status["sync"]["mode"])}</code></p>
    <section>
      <h2>Diagnostics</h2>
      <div class="row">
        <div class="metric">Hostname<br><strong>{html.escape(system["hostname"])}</strong></div>
        <div class="metric">IP<br><strong>{html.escape(system["ipAddresses"] or "unknown")}</strong></div>
        <div class="metric">CPU load<br><strong>{html.escape(str(system["cpuLoad"]))}</strong></div>
        <div class="metric">RAM used<br><strong>{html.escape(str(system["memory"]["usedMb"]))} MB / {html.escape(str(system["memory"]["totalMb"]))} MB</strong></div>
        <div class="metric">Disk used<br><strong>{html.escape(str(system["disk"]["usedPercent"]))}%</strong></div>
        <div class="metric">Cache<br><strong>{html.escape(str(system["cacheMb"]))} MB</strong></div>
        <div class="metric">Agent<br><strong>{html.escape(system["agentService"])}</strong></div>
        <div class="metric">WebUI<br><strong>{html.escape(system["webuiService"])}</strong></div>
      </div>
      <p><a href="/api/status">Open raw JSON status</a></p>
    </section>
    <table>
      <thead><tr><th>Output</th><th>Serial</th><th>Enabled</th><th>Connector</th><th>Manifest items</th></tr></thead>
      <tbody>{output_rows}</tbody>
    </table>
    <section>
      <h2>CMS i synchronizacja</h2>
      <form method="post" action="/api/config">
        <label for="server_url">Server URL</label>
        <input id="server_url" name="server_url" value="{html.escape(status["serverUrl"])}" required>
        <div class="row">
          <div>
            <label for="sync_mode">Sync mode</label>
            <select id="sync_mode" name="sync_mode">{_options(status["sync"]["mode"], ["independent", "paired_start", "clocked_playlist"])}</select>
          </div>
          <div>
            <label for="sync_policy">Sync policy</label>
            <select id="sync_policy" name="sync_policy">{_options(status["sync"]["policy"], ["best_effort", "strict"])}</select>
          </div>
          <div>
            <label for="tolerance_ms">Tolerance ms</label>
            <input id="tolerance_ms" name="tolerance_ms" type="number" min="0" max="5000" value="{html.escape(str(status["sync"]["toleranceMs"]))}">
          </div>
        </div>
        <button type="submit">Save config</button>
      </form>
    </section>
    <section>
      <h2>Siec</h2>
      <form method="post" action="/api/wifi">
        <label for="ssid">Wi-Fi SSID</label>
        <input id="ssid" name="ssid" autocomplete="off">
        <label for="password">Wi-Fi password</label>
        <input id="password" name="password" type="password" autocomplete="new-password">
        <label for="ipv4_method">IPv4</label>
        <select id="ipv4_method" name="ipv4_method">
          <option value="auto">DHCP</option>
          <option value="manual">Static</option>
        </select>
        <div class="row">
          <div><label for="address">Static address/CIDR</label><input id="address" name="address" placeholder="192.168.1.50/24"></div>
          <div><label for="gateway">Gateway</label><input id="gateway" name="gateway" placeholder="192.168.1.1"></div>
          <div><label for="dns">DNS</label><input id="dns" name="dns" placeholder="1.1.1.1 8.8.8.8"></div>
        </div>
        <p class="hint">Apply now zapisze Wi-Fi, utworzy {html.escape(status["setupLock"])}, wylaczy hotspot i zrestartuje agenta. To zwykle zerwie polaczenie z ta strona.</p>
        <button type="submit" name="apply_now" value="0">Save Wi-Fi profile</button>
        <button type="submit" name="apply_now" value="1">Apply now</button>
      </form>
    </section>
    <section>
      <h2>Czas</h2>
      <form method="post" action="/api/time">
        <label for="timezone">Timezone</label>
        <input id="timezone" name="timezone" value="{html.escape(system["timezone"])}" placeholder="Europe/Warsaw">
        <label><input type="checkbox" name="ntp" value="1" checked> Use NTP</label>
        <label for="datetime">Manual datetime</label>
        <input id="datetime" name="datetime" placeholder="2026-04-26 12:30:00">
        <button type="submit">Save time settings</button>
      </form>
    </section>
    <section>
      <h2>Update player</h2>
      <form method="post" action="/api/update-player">
        <label for="ref">Git branch/ref</label>
        <input id="ref" name="ref" value="codex/rpi-video-premium-player">
        <button type="submit">Run update</button>
      </form>
    </section>
    <section>
      <h2>Serwis</h2>
      <div class="actions">
        <form method="post" action="/api/restart-agent"><button type="submit">Restart agent</button></form>
        <form method="post" action="/api/force-playlist-update"><button type="submit">Restart playback</button></form>
        <form method="post" action="/api/lock-setup"><button type="submit">Mark setup complete</button></form>
        <form method="post" action="/api/reboot"><button type="submit">Reboot OS</button></form>
      </div>
      <p class="hint">Setup lock: <code>{html.escape(str(status["setupLocked"]))}</code></p>
    </section>
  </main>
</body>
</html>"""

    def save_config(self, fields: dict[str, str]) -> str:
        config = self.provider.config
        server_url = fields.get("server_url", config.server_url).strip().rstrip("/") or config.server_url
        sync_mode = fields.get("sync_mode", config.sync.mode).strip() or config.sync.mode
        sync_policy = fields.get("sync_policy", config.sync.policy).strip() or config.sync.policy
        tolerance_ms = _int(fields.get("tolerance_ms"), config.sync.tolerance_ms)
        payload = _render_config_toml(config, server_url, sync_mode, sync_policy, tolerance_ms)
        self.provider.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.provider.config_path.write_text(payload, encoding="utf-8")
        self.provider.config_path.chmod(0o640)
        self.provider.config = load_config(self.provider.config_path)
        return "Config saved"

    def save_wifi(self, fields: dict[str, str]) -> str:
        ssid = fields.get("ssid", "").strip()
        if not ssid:
            raise ValueError("Wi-Fi SSID is required")
        password = fields.get("password", "")
        method = fields.get("ipv4_method", "auto").strip() or "auto"
        commands = [
            ["nmcli", "connection", "delete", "SignalDeck-WiFi"],
            ["nmcli", "connection", "add", "type", "wifi", "ifname", "wlan0", "con-name", "SignalDeck-WiFi", "ssid", ssid],
            ["nmcli", "connection", "modify", "SignalDeck-WiFi", "connection.autoconnect", "yes"],
        ]
        if password:
            commands.append(["nmcli", "connection", "modify", "SignalDeck-WiFi", "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password])
        if method == "manual":
            address = fields.get("address", "").strip()
            gateway = fields.get("gateway", "").strip()
            dns = fields.get("dns", "").strip()
            if not address or not gateway:
                raise ValueError("Static IPv4 requires address and gateway")
            commands.append(["nmcli", "connection", "modify", "SignalDeck-WiFi", "ipv4.method", "manual", "ipv4.addresses", address, "ipv4.gateway", gateway])
            if dns:
                commands.append(["nmcli", "connection", "modify", "SignalDeck-WiFi", "ipv4.dns", dns])
        else:
            commands.append(["nmcli", "connection", "modify", "SignalDeck-WiFi", "ipv4.method", "auto"])

        for command in commands:
            _run(command, allow_failure=command[:3] == ["nmcli", "connection", "delete"])

        if fields.get("apply_now") == "1":
            self.mark_setup_complete()
            _run(["systemctl", "restart", "signaldeck-agent.service"], allow_failure=True)
            _run(["nmcli", "connection", "down", "SignalDeck-Setup"], allow_failure=True)
            _run(["nmcli", "connection", "up", "SignalDeck-WiFi"], allow_failure=True)
            return "Wi-Fi saved and applied"
        return "Wi-Fi profile saved"

    def restart_agent(self) -> str:
        _run(["systemctl", "restart", "signaldeck-agent.service"])
        return "Agent restarted"

    def save_time(self, fields: dict[str, str]) -> str:
        timezone = fields.get("timezone", "").strip()
        if timezone:
            _run(["timedatectl", "set-timezone", timezone])
        _run(["timedatectl", "set-ntp", "true" if fields.get("ntp") == "1" else "false"], allow_failure=True)
        datetime_value = fields.get("datetime", "").strip()
        if datetime_value:
            _run(["timedatectl", "set-time", datetime_value], allow_failure=True)
        return "Time settings saved"

    def update_player(self, fields: dict[str, str]) -> str:
        ref = fields.get("ref", "codex/rpi-video-premium-player").strip() or "codex/rpi-video-premium-player"
        quoted_ref = shlex.quote(ref)
        command = (
            "curl -fsSL "
            f"https://raw.githubusercontent.com/berry-secure/digital-signage/{quoted_ref}/scripts/rpi/install-video-premium.sh "
            "-o /tmp/install-signaldeck.sh && "
            f"SIGNALDECK_REF={quoted_ref} bash /tmp/install-signaldeck.sh"
        )
        _run(["bash", "-lc", command])
        return "Update started"

    def force_playlist_update(self) -> str:
        manifests_dir = self.provider.state_root / "manifests"
        if manifests_dir.exists():
            for path in manifests_dir.glob("*.json"):
                path.unlink(missing_ok=True)
        _run(["systemctl", "restart", "signaldeck-agent.service"], allow_failure=True)
        return "Playlist refresh requested"

    def reboot_os(self) -> str:
        _run(["systemctl", "reboot"], allow_failure=True)
        return "Reboot requested"

    def mark_setup_complete(self) -> str:
        self.provider.boot_dir.mkdir(parents=True, exist_ok=True)
        (self.provider.boot_dir / "SIGNALDECK_LOCK").write_text("configured\n", encoding="utf-8")
        return "Setup marked complete"


def make_handler(app: WebUiApp):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/status":
                payload = json.dumps(app.render_status_json()).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

            payload = app.render_index_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            try:
                fields = _read_form(self)
                if self.path == "/api/config":
                    message = app.save_config(fields)
                elif self.path == "/api/wifi":
                    message = app.save_wifi(fields)
                elif self.path == "/api/restart-agent":
                    message = app.restart_agent()
                elif self.path == "/api/time":
                    message = app.save_time(fields)
                elif self.path == "/api/update-player":
                    message = app.update_player(fields)
                elif self.path == "/api/force-playlist-update":
                    message = app.force_playlist_update()
                elif self.path == "/api/reboot":
                    message = app.reboot_os()
                elif self.path == "/api/lock-setup":
                    message = app.mark_setup_complete()
                else:
                    self.send_error(404)
                    return
                self._redirect(message)
            except Exception as error:
                self.send_response(400)
                payload = f"Request failed: {html.escape(str(error))}".encode("utf-8")
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        def _redirect(self, message: str):
            self.send_response(303)
            self.send_header("Location", f"/?message={html.escape(message)}")
            self.end_headers()

        def log_message(self, format, *args):
            return

    return Handler


def run_server(host: str, port: int, provider: StatusProvider) -> None:
    app = WebUiApp(provider)
    server = ThreadingHTTPServer((host, port), make_handler(app))
    server.serve_forever()


def create_provider(
    config_path: str | Path = "/etc/signaldeck/player.toml",
    identity_path: str | Path = "/var/lib/signaldeck/identity.json",
    state_root: str | Path = "/var/lib/signaldeck",
    boot_dir: str | Path = "/boot/firmware",
) -> StatusProvider:
    config = load_config(config_path)
    identity = load_or_create_system_identity(identity_path, config.outputs)
    return StatusProvider(config, identity, Path(state_root), Path(config_path), Path(boot_dir))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--config", default="/etc/signaldeck/player.toml")
    parser.add_argument("--identity", default="/var/lib/signaldeck/identity.json")
    parser.add_argument("--state-root", default="/var/lib/signaldeck")
    parser.add_argument("--boot-dir", default="/boot/firmware")
    args = parser.parse_args(argv)
    run_server(args.host, args.port, create_provider(args.config, args.identity, args.state_root, args.boot_dir))


def _read_form(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    length = int(handler.headers.get("content-length", "0"))
    raw = handler.rfile.read(length).decode("utf-8")
    return {key: values[-1] for key, values in parse_qs(raw, keep_blank_values=True).items()}


def _options(selected: str, values: list[str]) -> str:
    return "".join(
        f'<option value="{html.escape(value)}"{" selected" if value == selected else ""}>{html.escape(value)}</option>'
        for value in values
    )


def _render_config_toml(config: PlayerConfig, server_url: str, sync_mode: str, sync_policy: str, tolerance_ms: int) -> str:
    outputs = "\n".join(
        f'\n[[outputs]]\nname = "{output.name}"\nserial_suffix = "{output.serial_suffix}"\nenabled = {"true" if output.enabled else "false"}\n'
        for output in config.outputs
    )
    return f'''server_url = "{server_url}"
device_model = "{config.device_model}"
player_type = "{config.player_type}"
app_version = "{config.app_version}"
cache_limit_mb = {config.cache_limit_mb}
heartbeat_interval_seconds = {config.heartbeat_interval_seconds}

[sync]
mode = "{sync_mode}"
group = "{config.sync.group}"
policy = "{sync_policy}"
tolerance_ms = {max(tolerance_ms, 0)}
group_blackout = {"true" if config.sync.group_blackout else "false"}
{outputs}'''


def _int(value: str | None, fallback: int) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return fallback


def _run(command: list[str], allow_failure: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 and not allow_failure:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(f"{' '.join(command)}: {detail}")
    return result


def _capture(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _cpu_load() -> float:
    try:
        return round(os.getloadavg()[0], 2)
    except OSError:
        return 0.0


def _memory_status() -> dict[str, int]:
    meminfo = Path("/proc/meminfo")
    if not meminfo.exists():
        return {"totalMb": 0, "usedMb": 0, "freeMb": 0}
    values: dict[str, int] = {}
    for line in meminfo.read_text(encoding="utf-8").splitlines():
        key, _, rest = line.partition(":")
        number = rest.strip().split(" ", 1)[0]
        if number.isdigit():
            values[key] = int(number)
    total = values.get("MemTotal", 0) // 1024
    available = values.get("MemAvailable", 0) // 1024
    used = max(total - available, 0)
    return {"totalMb": total, "usedMb": used, "freeMb": available}


def _directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _read_timezone() -> str:
    timezone = Path("/etc/timezone")
    if timezone.exists():
        return timezone.read_text(encoding="utf-8").strip() or "Europe/Warsaw"
    return "Europe/Warsaw"
