import struct
import unittest

from signaldeck_rpi.hotkeys import (
    EV_KEY,
    INPUT_EVENT_FORMAT,
    KEY_LEFTALT,
    KEY_LEFTCTRL,
    KEY_S,
    HotkeyState,
    parse_input_event,
)


class HotkeyTest(unittest.TestCase):
    def test_ctrl_alt_s_triggers_service_console_once(self):
        state = HotkeyState()

        self.assertFalse(state.handle_key_event(KEY_LEFTCTRL, 1))
        self.assertFalse(state.handle_key_event(KEY_LEFTALT, 1))
        self.assertTrue(state.handle_key_event(KEY_S, 1))
        self.assertFalse(state.handle_key_event(KEY_S, 2))

    def test_parse_input_event_reads_linux_event_record(self):
        raw = struct.pack(INPUT_EVENT_FORMAT, 1, 2, EV_KEY, KEY_S, 1)

        event = parse_input_event(raw)

        self.assertIsNotNone(event)
        self.assertEqual(event.type, EV_KEY)
        self.assertEqual(event.code, KEY_S)
        self.assertEqual(event.value, 1)


if __name__ == "__main__":
    unittest.main()
