import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


class InstallScriptTest(unittest.TestCase):
    def test_zero2wh_installer_exists_with_hardware_check_and_single_output_config(self):
        script = REPO_ROOT / "scripts" / "rpi" / "install-zero2wh-player.sh"

        content = script.read_text(encoding="utf-8")

        self.assertIn("Raspberry Pi Zero 2 W", content)
        self.assertIn('device_model = "Raspberry Pi Zero 2 WH"', content)
        self.assertIn('app_version = "rpi-zero2wh-0.1.0"', content)
        self.assertIn("audio_enabled = false", content)
        self.assertIn('name = "HDMI-A-1"', content)
        self.assertNotIn('name = "HDMI-A-2"', content)

    def test_zero2wh_golden_image_uses_zero2wh_installer_and_branch(self):
        script = REPO_ROOT / "scripts" / "rpi" / "prepare-zero2wh-golden-image.sh"

        content = script.read_text(encoding="utf-8")

        self.assertIn("install-zero2wh-player.sh", content)
        self.assertIn("codex/rpi-zero-2wh-player", content)
        self.assertIn("identity.json", content)
        self.assertIn("SIGNALDECK_HOTSPOT.txt", content)
        self.assertIn("queue/logs", content)
        self.assertIn("chown -R", content)

    def test_installer_creates_runtime_spool_directories_for_agent_user(self):
        script = REPO_ROOT / "scripts" / "rpi" / "install-video-premium.sh"

        content = script.read_text(encoding="utf-8")

        self.assertIn('"${STATE_DIR}/cache/media"', content)
        self.assertIn('"${STATE_DIR}/proof-of-play"', content)
        self.assertIn('"${STATE_DIR}/queue/logs"', content)


if __name__ == "__main__":
    unittest.main()
