import unittest
from unittest.mock import Mock, patch

from signaldeck_rpi.service_console import ServiceConsole, build_service_menu, summarize_status


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

    def test_console_does_not_stop_playback_if_tty_cannot_open(self):
        pause_playback = Mock()
        resume_playback = Mock()
        console = ServiceConsole(None, pause_playback=pause_playback, resume_playback=resume_playback)

        with patch("signaldeck_rpi.service_console.curses.wrapper", side_effect=RuntimeError("no tty")):
            with self.assertRaises(RuntimeError):
                console.run()

        pause_playback.assert_not_called()
        resume_playback.assert_not_called()

    def test_console_always_resumes_playback_after_entering_tty(self):
        pause_playback = Mock()
        resume_playback = Mock()
        console = ServiceConsole(None, pause_playback=pause_playback, resume_playback=resume_playback)
        console._loop = Mock(side_effect=RuntimeError("boom"))

        with patch("signaldeck_rpi.service_console.curses.wrapper", side_effect=lambda callback: callback(object())):
            with self.assertRaises(RuntimeError):
                console.run()

        pause_playback.assert_called_once_with()
        resume_playback.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
