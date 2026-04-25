import tempfile
import unittest
from pathlib import Path

from signaldeck_rpi.playback import (
    build_mpv_command,
    build_mpv_playlist_command,
    playback_decision,
    probe_drm_connector_states,
    probe_drm_connectors,
)


class PlaybackTest(unittest.TestCase):
    def test_mpv_command_targets_drm_connector_for_video(self):
        command = build_mpv_command("/cache/clip.mp4", "HDMI-A-1", "video", 30, 80)

        self.assertEqual(command[0], "mpv")
        self.assertIn("--fs", command)
        self.assertIn("--drm-connector=HDMI-A-1", command)
        self.assertIn("--loop-playlist=inf", command)
        self.assertIn("--volume=80", command)
        self.assertIn("/cache/clip.mp4", command)

    def test_mpv_playlist_command_loops_multiple_files_without_exiting(self):
        command = build_mpv_playlist_command(["/cache/clip-a.mp4", "/cache/clip-b.mp4"], "HDMI-A-1", 80, 10)

        self.assertIn("--loop-playlist=inf", command)
        self.assertIn("--force-window=immediate", command)
        self.assertEqual(command[-2:], ["/cache/clip-a.mp4", "/cache/clip-b.mp4"])

    def test_mpv_command_sets_image_duration(self):
        command = build_mpv_command("/cache/menu.png", "HDMI-A-2", "image", 12, 0)

        self.assertIn("--image-display-duration=12", command)
        self.assertIn("--no-audio", command)

    def test_audio_items_are_skipped_with_warning(self):
        decision = playback_decision({"kind": "audio", "title": "Song"})

        self.assertEqual(decision.action, "skip")
        self.assertEqual(decision.severity, "warn")
        self.assertIn("audio", decision.message)

    def test_probe_drm_connectors_finds_hdmi_suffixes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hdmi1 = root / "card1-HDMI-A-1"
            hdmi2 = root / "card1-HDMI-A-2"
            hdmi1.mkdir()
            hdmi2.mkdir()
            (hdmi1 / "status").write_text("connected\n", encoding="utf-8")
            (hdmi2 / "status").write_text("disconnected\n", encoding="utf-8")
            (root / "card1-Writeback-1").mkdir()

            connectors = probe_drm_connectors(root)
            states = probe_drm_connector_states(root)

        self.assertEqual(connectors["HDMI-A-1"], "card1-HDMI-A-1")
        self.assertEqual(connectors["HDMI-A-2"], "card1-HDMI-A-2")
        self.assertTrue(states["HDMI-A-1"].connected)
        self.assertFalse(states["HDMI-A-2"].connected)
        self.assertEqual(states["HDMI-A-2"].status, "disconnected")


if __name__ == "__main__":
    unittest.main()
