import unittest

from signaldeck_rpi.commands import route_command


class CommandsTest(unittest.TestCase):
    def test_route_reboot_is_global_action(self):
        action = route_command({"id": "1", "type": "reboot_os", "payload": {}})

        self.assertEqual(action.scope, "global")
        self.assertEqual(action.ack_status, "acked")
        self.assertEqual(action.effect, "reboot_os")

    def test_route_set_volume_can_be_noop(self):
        action = route_command({"id": "2", "type": "set_volume", "payload": {"volumePercent": 42}})

        self.assertEqual(action.scope, "output")
        self.assertEqual(action.ack_status, "acked")
        self.assertEqual(action.effect, "set_volume")

    def test_unknown_command_fails_clearly(self):
        action = route_command({"id": "3", "type": "rotate_secret", "payload": {}})

        self.assertEqual(action.ack_status, "failed")
        self.assertIn("not supported", action.message)


if __name__ == "__main__":
    unittest.main()
