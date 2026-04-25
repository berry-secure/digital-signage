import stat
import unittest

from signaldeck_rpi.config import OutputConfig
from signaldeck_rpi.identity import derive_base_serial, load_or_create_identity, normalize_serial


class IdentityTest(unittest.TestCase):
    def test_normalize_serial_allows_only_uppercase_letters_and_digits(self):
        self.assertEqual(normalize_serial(" mk-5 abc:123 "), "MK5ABC123")

    def test_derive_base_serial_prefers_cpu_serial(self):
        cpuinfo = "Hardware\t: BCM2712\nSerial\t\t: 00000000deadbeef\n"

        self.assertEqual(derive_base_serial(cpuinfo, "machine-id", "fallback"), "MKDEADBEEF")

    def test_derive_base_serial_uses_machine_id_when_cpu_serial_missing(self):
        base = derive_base_serial("Hardware\t: BCM2712\n", "abcd-1234-efgh", "fallback")

        self.assertEqual(base, "MKABCD1234EFGH")

    def test_load_or_create_identity_persists_output_secrets(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            identity_path = Path(directory) / "identity.json"
            outputs = [OutputConfig("HDMI-A-1", "A", True), OutputConfig("HDMI-A-2", "B", True)]

            identity = load_or_create_identity(identity_path, "MK5ABC123", outputs)

            self.assertEqual(identity.base_serial, "MK5ABC123")
            self.assertEqual(identity.outputs["HDMI-A-1"].serial, "MK5ABC123A")
            self.assertEqual(identity.outputs["HDMI-A-2"].serial, "MK5ABC123B")
            self.assertTrue(identity.outputs["HDMI-A-1"].secret)
            self.assertEqual(stat.S_IMODE(identity_path.stat().st_mode), 0o600)
            self.assertEqual(load_or_create_identity(identity_path, "IGNORED", outputs).base_serial, "MK5ABC123")


if __name__ == "__main__":
    unittest.main()
