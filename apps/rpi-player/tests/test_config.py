import textwrap
import unittest

from signaldeck_rpi.config import OutputConfig, default_config, load_config


class ConfigTest(unittest.TestCase):
    def test_default_config_has_dual_hdmi_outputs(self):
        config = default_config()

        self.assertEqual(config.server_url, "https://cms.berry-secure.pl")
        self.assertEqual([output.name for output in config.outputs], ["HDMI-A-1", "HDMI-A-2"])
        self.assertEqual([output.serial_suffix for output in config.outputs], ["A", "B"])
        self.assertEqual(config.sync.mode, "independent")

    def test_load_config_reads_sync_and_outputs(self):
        path = self._tmp_path(
            textwrap.dedent(
                """
                server_url = "https://cms.example.test"
                cache_limit_mb = 1024

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
        self.assertEqual(config.sync.mode, "clocked_playlist")
        self.assertEqual(config.sync.policy, "strict")
        self.assertEqual(config.sync.tolerance_ms, 125)
        self.assertEqual(config.outputs, [OutputConfig("HDMI-A-1", "A", True)])

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
