import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from signaldeck_rpi.config import default_config
from signaldeck_rpi.identity import load_or_create_identity
from signaldeck_rpi.webui import StatusProvider, WebUiApp


class WebUiTest(unittest.TestCase):
    def test_webui_status_json_contains_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            config = default_config()
            identity = load_or_create_identity(Path(directory) / "identity.json", "MK5ABC123", config.outputs)
            provider = StatusProvider(config, identity, state_root=Path(directory))
            app = WebUiApp(provider)

            body = app.render_status_json()

        self.assertEqual(body["baseSerial"], "MK5ABC123")
        self.assertIn("HDMI-A-1", body["outputs"])
        self.assertIn("HDMI-A-2", body["outputs"])
        self.assertEqual(body["serverUrl"], "https://cms.berry-secure.pl")

    def test_webui_renders_html_with_status_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            config = default_config()
            identity = load_or_create_identity(Path(directory) / "identity.json", "MK5ABC123", config.outputs)
            provider = StatusProvider(config, identity, state_root=Path(directory))
            app = WebUiApp(provider)

            html = app.render_index_html()

        self.assertIn("Signal Deck", html)
        self.assertIn("HDMI-A-1", html)
        self.assertIn("MK5ABC123A", html)
        self.assertIn("Wi-Fi SSID", html)
        self.assertIn("Save config", html)
        self.assertIn("Timezone", html)
        self.assertIn("Update player", html)
        self.assertIn("Restart playback", html)
        self.assertIn("Diagnostics", html)
        self.assertIn("CPU load", html)

    def test_webui_save_config_updates_player_toml(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = default_config()
            identity = load_or_create_identity(root / "identity.json", "MK5ABC123", config.outputs)
            config_path = root / "player.toml"
            provider = StatusProvider(config, identity, state_root=root, config_path=config_path, boot_dir=root / "boot")
            app = WebUiApp(provider)

            message = app.save_config(
                {
                    "server_url": "https://cms.example.test/",
                    "sync_mode": "clocked_playlist",
                    "sync_policy": "strict",
                    "tolerance_ms": "125",
                }
            )

            self.assertEqual(message, "Config saved")
            saved = config_path.read_text(encoding="utf-8")
            self.assertIn('server_url = "https://cms.example.test"', saved)
            self.assertIn('mode = "clocked_playlist"', saved)
            self.assertIn('policy = "strict"', saved)
            self.assertIn("tolerance_ms = 125", saved)

    def test_webui_save_time_invokes_timedatectl(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self._app(Path(directory))

            with patch("signaldeck_rpi.webui._run") as run:
                message = app.save_time({"timezone": "Europe/Warsaw", "ntp": "1", "datetime": "2026-04-26 12:30:00"})

            self.assertEqual(message, "Time settings saved")
            run.assert_any_call(["timedatectl", "set-timezone", "Europe/Warsaw"])
            run.assert_any_call(["timedatectl", "set-ntp", "true"], allow_failure=True)
            run.assert_any_call(["timedatectl", "set-time", "2026-04-26 12:30:00"], allow_failure=True)

    def test_webui_update_player_runs_branch_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self._app(Path(directory))

            with patch("signaldeck_rpi.webui._run") as run:
                message = app.update_player({"ref": "codex/rpi-video-premium-player"})

            self.assertEqual(message, "Update started")
            command = run.call_args.args[0]
            self.assertEqual(command[:2], ["bash", "-lc"])
            self.assertIn("SIGNALDECK_REF=codex/rpi-video-premium-player", command[2])
            self.assertIn("install-video-premium.sh", command[2])

    def test_webui_force_playlist_update_clears_manifests_and_restarts_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_dir = root / "manifests"
            manifest_dir.mkdir()
            (manifest_dir / "HDMI-A-1.json").write_text("[]", encoding="utf-8")
            app = self._app(root)

            with patch("signaldeck_rpi.webui._run") as run:
                message = app.force_playlist_update()

            self.assertEqual(message, "Playlist refresh requested")
            self.assertFalse((manifest_dir / "HDMI-A-1.json").exists())
            run.assert_called_with(["systemctl", "restart", "signaldeck-agent.service"], allow_failure=True)

    def _app(self, root: Path):
        config = default_config()
        identity = load_or_create_identity(root / "identity.json", "MK5ABC123", config.outputs)
        provider = StatusProvider(config, identity, state_root=root, config_path=root / "player.toml", boot_dir=root / "boot")
        return WebUiApp(provider)


if __name__ == "__main__":
    unittest.main()
