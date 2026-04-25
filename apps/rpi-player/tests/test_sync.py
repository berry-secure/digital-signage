import unittest

from signaldeck_rpi.sync import plan_clocked_timeline, validate_clocked_queues


class SyncTest(unittest.TestCase):
    def test_sync_reports_mismatched_slot_count(self):
        result = validate_clocked_queues([{"durationSeconds": 10}], [{"durationSeconds": 10}, {"durationSeconds": 10}], 250)

        self.assertFalse(result.compatible)
        self.assertIn("slot count", result.message)

    def test_sync_accepts_duration_within_tolerance(self):
        result = validate_clocked_queues([{"durationSeconds": 10.0}], [{"durationSeconds": 10.1}], 250)

        self.assertTrue(result.compatible)

    def test_sync_rejects_duration_outside_tolerance(self):
        result = validate_clocked_queues([{"durationSeconds": 10.0}], [{"durationSeconds": 10.5}], 250)

        self.assertFalse(result.compatible)
        self.assertIn("duration", result.message)

    def test_plan_clocked_timeline_uses_shared_start_times(self):
        slots = plan_clocked_timeline(
            [{"id": "left-1", "durationSeconds": 10}, {"id": "left-2", "durationSeconds": 5}],
            [{"id": "right-1", "durationSeconds": 10}, {"id": "right-2", "durationSeconds": 5}],
            start_monotonic=100.0,
            tolerance_ms=250,
        )

        self.assertEqual([slot.start_monotonic for slot in slots["HDMI-A-1"]], [100.0, 110.0])
        self.assertEqual([slot.start_monotonic for slot in slots["HDMI-A-2"]], [100.0, 110.0])


if __name__ == "__main__":
    unittest.main()
