from __future__ import annotations

from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import argparse
import html
import json

from .config import PlayerConfig, load_config
from .identity import PlayerIdentity, load_or_create_system_identity
from .playback import probe_drm_connectors


@dataclass
class StatusProvider:
    config: PlayerConfig
    identity: PlayerIdentity
    state_root: Path = Path("/var/lib/signaldeck")

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
            "sync": {
                "mode": self.config.sync.mode,
                "group": self.config.sync.group,
                "policy": self.config.sync.policy,
                "toleranceMs": self.config.sync.tolerance_ms,
            },
            "outputs": outputs,
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


@dataclass
class WebUiApp:
    provider: StatusProvider

    def render_status_json(self) -> dict[str, Any]:
        return self.provider.snapshot()

    def render_index_html(self) -> str:
        status = self.render_status_json()
        output_rows = "\n".join(
            f"<tr><td>{html.escape(name)}</td><td>{html.escape(value['serial'])}</td><td>{html.escape(str(value['enabled']))}</td></tr>"
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
    table {{ width: 100%; border-collapse: collapse; background: white; }}
    th, td {{ padding: .75rem; border-bottom: 1px solid #ddd; text-align: left; }}
    code {{ background: #eee; padding: .15rem .3rem; }}
  </style>
</head>
<body>
  <main>
    <h1>Signal Deck Player</h1>
    <p>Base serial: <code>{html.escape(status["baseSerial"])}</code></p>
    <p>Server: <code>{html.escape(status["serverUrl"])}</code></p>
    <p>Sync: <code>{html.escape(status["sync"]["mode"])}</code></p>
    <table>
      <thead><tr><th>Output</th><th>Serial</th><th>Enabled</th></tr></thead>
      <tbody>{output_rows}</tbody>
    </table>
  </main>
</body>
</html>"""


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
) -> StatusProvider:
    config = load_config(config_path)
    identity = load_or_create_system_identity(identity_path, config.outputs)
    return StatusProvider(config, identity, Path(state_root))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--config", default="/etc/signaldeck/player.toml")
    parser.add_argument("--identity", default="/var/lib/signaldeck/identity.json")
    parser.add_argument("--state-root", default="/var/lib/signaldeck")
    args = parser.parse_args(argv)
    run_server(args.host, args.port, create_provider(args.config, args.identity, args.state_root))
