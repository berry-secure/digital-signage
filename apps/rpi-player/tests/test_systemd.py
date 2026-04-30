import unittest
from pathlib import Path


class SystemdUnitTest(unittest.TestCase):
    def test_agent_does_not_wait_for_network_online_before_cached_playback(self):
        unit_path = Path(__file__).resolve().parents[1] / "systemd" / "signaldeck-agent.service"
        unit = unit_path.read_text(encoding="utf-8")

        self.assertIn("After=network.target", unit)
        self.assertIn("Wants=network.target", unit)
        self.assertNotIn("network-online.target", unit)


if __name__ == "__main__":
    unittest.main()
