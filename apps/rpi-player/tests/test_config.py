import textwrap
import unittest

from signaldeck_rpi.config import OutputConfig, default_config, load_config, render_config_toml, zero2wh_config, zero2wh_config_toml


class ConfigTest(unittest.TestCase):
    def test_default_config_has_dual_hdmi_outputs(self):
        config = default_config()

        self.assertEqual(config.server_url, "https://maasck-ds.online")
        self.assertEqual([output.name for output in config.outputs], ["HDMI-A-1", "HDMI-A-2"])
        self.assertEqual([output.serial_suffix for output in config.outputs], ["A", "B"])
        self.assertEqual(config.sync.mode, "independent")
        self.assertTrue(config.audio_enabled)

    def test_zero2wh_config_is_single_hdmi_without_audio(self):
        config = zero2wh_config()

        self.assertEqual(config.device_model, "Raspberry Pi Zero 2 WH")
        self.assertEqual(config.app_version, "rpi-zero2wh-0.1.0")
        self.assertEqual(config.cache_limit_mb, 40960)
        self.assertEqual(config.sync.mode, "single")
        self.assertEqual(config.sync.group, "single-hdmi")
        self.assertFalse(config.sync.group_blackout)
        self.assertEqual(config.outputs, [OutputConfig("HDMI-A-1", "", True)])
        self.assertFalse(config.audio_enabled)

    def test_zero2wh_config_toml_contains_runtime_defaults(self):
        payload = zero2wh_config_toml()

        self.assertIn('device_model = "Raspberry Pi Zero 2 WH"', payload)
        self.assertIn('app_version = "rpi-zero2wh-0.1.0"', payload)
        self.assertIn('audio_enabled = false', payload)
        self.assertIn('serial_suffix = ""', payload)
        self.assertNotIn('HDMI-A-2', payload)

    def test_load_config_reads_sync_and_outputs(self):
        path = self._tmp_path(
            textwrap.dedent(
                """
                server_url = "https://cms.example.test"
                cache_limit_mb = 1024
                audio_enabled = false

                [sync]
                mode = "clocked_playlist"
                policy = "strict"
                tolerance_ms = 125

                [[outputs]]
                name = "HDMI-A-1"
                serial_suffix = "A"
                enabled = true
                """
            ).strip()
        )

        config = load_config(path)

        self.assertEqual(config.server_url, "https://cms.example.test")
        self.assertEqual(config.cache_limit_mb, 1024)
        self.assertFalse(config.audio_enabled)
        self.assertEqual(config.sync.mode, "clocked_playlist")
        self.assertEqual(config.sync.policy, "strict")
        self.assertEqual(config.sync.tolerance_ms, 125)
        self.assertEqual(config.outputs, [OutputConfig("HDMI-A-1", "A", True)])

    def test_load_config_normalizes_server_url_to_https_without_trailing_slash(self):
        path = self._tmp_path('server_url = "http://maasck-ds.online/"')

        config = load_config(path)

        self.assertEqual(config.server_url, "https://maasck-ds.online")

    def test_render_config_toml_normalizes_server_url(self):
        payload = render_config_toml(default_config(), server_url="http://maasck-ds.online/")

        self.assertIn('server_url = "https://maasck-ds.online"', payload)

    def _tmp_path(self, content):
        import tempfile
        from pathlib import Path

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "player.toml"
        path.write_text(content, encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main()
