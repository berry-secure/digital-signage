import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
