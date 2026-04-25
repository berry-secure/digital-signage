import unittest

from signaldeck_rpi.service_console import build_service_menu, summarize_status


class ServiceConsoleTest(unittest.TestCase):
    def test_service_menu_exposes_core_technician_actions(self):
        labels = [item.label for item in build_service_menu()]

        self.assertIn("Refresh status", labels)
        self.assertIn("Restart playback", labels)
        self.assertIn("CMS and sync settings", labels)
        self.assertIn("Wi-Fi and IPv4 settings", labels)
        self.assertIn("Time settings", labels)
        self.assertIn("Update player", labels)
        self.assertIn("Reboot OS", labels)
        self.assertEqual(labels[-1], "Exit and resume playback")

    def test_status_summary_includes_connector_state_and_system_health(self):
        lines = summarize_status(
            {
                "baseSerial": "MK5ABC123",
                "serverUrl": "https://cms.example.test",
                "sync": {"mode": "independent"},
                "system": {
                    "hostname": "player-01",
                    "ipAddresses": "10.42.0.1",
                    "cpuLoad": 0.23,
                    "memory": {"usedMb": 256, "totalMb": 2048},
                    "disk": {"usedPercent": 12.5},
                    "cacheMb": 81.2,
                    "timezone": "Europe/Warsaw",
                    "agentService": "active",
                    "webuiService": "active",
                },
                "outputs": {
                    "HDMI-A-1": {
                        "serial": "MK5ABC123A",
                        "enabled": True,
                        "connector": "card1-HDMI-A-1",
                        "connectorStatus": "connected",
                        "manifestItems": 2,
                    },
                    "HDMI-A-2": {
                        "serial": "MK5ABC123B",
                        "enabled": True,
                        "connector": "card1-HDMI-A-2",
                        "connectorStatus": "disconnected",
                        "manifestItems": 0,
                    },
                },
            }
        )

        text = "\n".join(lines)
        self.assertIn("Serial: MK5ABC123", text)
        self.assertIn("HDMI-A-1: connected", text)
        self.assertIn("HDMI-A-2: disconnected", text)
        self.assertIn("CPU load: 0.23", text)


if __name__ == "__main__":
    unittest.main()
