import tempfile
import unittest
from pathlib import Path

from signaldeck_rpi.firstboot import FirstBootProvisioner


class FirstBootTest(unittest.TestCase):
    def test_firstboot_generates_hotspot_credentials_and_resets_device_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_dir = root / "etc"
            state_root = root / "state"
            boot_dir = root / "boot"
            config_dir.mkdir()
            state_root.mkdir()
            boot_dir.mkdir()
            (state_root / "identity.json").write_text("{}", encoding="utf-8")
            (boot_dir / "SIGNALDECK_LOCK").write_text("configured\n", encoding="utf-8")
            commands = []

            provisioner = FirstBootProvisioner(
                config_dir=config_dir,
                state_root=state_root,
                boot_dir=boot_dir,
                runner=lambda command, allow_failure=False: commands.append((command, allow_failure)),
                random_suffix=lambda: "ABC123",
                random_password=lambda: "RandomWiFi23646",
            )

            changed = provisioner.run(webui_password="Maasck23646")

            self.assertTrue(changed)
            self.assertFalse((state_root / "identity.json").exists())
            self.assertFalse((boot_dir / "SIGNALDECK_LOCK").exists())
            self.assertEqual((config_dir / "webui.secret").read_text(encoding="utf-8").strip(), "Maasck23646")
            self.assertEqual((config_dir / "hotspot.secret").read_text(encoding="utf-8").strip(), "RandomWiFi23646")
            handoff = (boot_dir / "SIGNALDECK_HOTSPOT.txt").read_text(encoding="utf-8")
            self.assertIn("SignalDeck-ABC123", handoff)
            self.assertIn("RandomWiFi23646", handoff)
            self.assertIn("admin", handoff)
            self.assertIn("Maasck23646", handoff)
            self.assertIn(["nmcli", "connection", "modify", "SignalDeck-Setup", "802-11-wireless.ssid", "SignalDeck-ABC123"], [entry[0] for entry in commands])
            self.assertTrue((state_root / "firstboot.done").exists())

    def test_firstboot_is_idempotent_after_done_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_root = root / "state"
            state_root.mkdir()
            (state_root / "firstboot.done").write_text("done\n", encoding="utf-8")
            commands = []
            provisioner = FirstBootProvisioner(
                config_dir=root / "etc",
                state_root=state_root,
                boot_dir=root / "boot",
                runner=lambda command, allow_failure=False: commands.append(command),
            )

            changed = provisioner.run(webui_password="Maasck23646")

            self.assertFalse(changed)
            self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()
