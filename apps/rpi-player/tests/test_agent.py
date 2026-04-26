import tempfile
import unittest
from pathlib import Path

from signaldeck_rpi.agent import AgentRuntime
from signaldeck_rpi.cache import MediaCache
from signaldeck_rpi.cms import CmsClient
from signaldeck_rpi.config import default_config
from signaldeck_rpi.identity import load_or_create_identity


class FakeCmsClient(CmsClient):
    def __init__(self):
        self.sessions = []
        self.acks = []
        self.logs = []

    def post_session(self, payload):
        self.sessions.append(payload)
        return {
            "approvalStatus": "approved",
            "device": {"approvalStatus": "approved", "desiredDisplayState": "active"},
            "playback": {
                "mode": "playlist",
                "queue": [
                    {"id": "item:0", "kind": "video", "url": "https://cms.example.test/uploads/clip.mp4", "durationSeconds": 10},
                    {"id": "item:1", "kind": "video", "url": "https://cms.example.test/uploads/clip-2.mp4", "durationSeconds": 12},
                ],
            },
            "commands": [{"id": "command-1", "type": "force_playlist_update", "payload": {}}],
            "serverTime": "2026-04-25T00:00:00.000Z",
        }

    def ack_command(self, command_id, serial, secret, status, message):
        self.acks.append((command_id, serial, status, message))
        return {"command": {"status": status}}

    def post_log(self, serial, secret, severity, component, message, **extra):
        self.logs.append((serial, severity, component, message, extra))
        return {"deviceLog": {"message": message}}


class FakeProofReporter:
    def __init__(self):
        self.started = []
        self.stopped = []
        self.flushed = 0

    def start_output(self, output, serial, secret, queue, is_running):
        self.started.append((output, serial, [item["id"] for item in queue]))

    def stop_output(self, output):
        self.stopped.append(output)

    def flush_pending(self):
        self.flushed += 1
        return 0


class FakePlaybackController:
    def __init__(self):
        self.played = []
        self.stopped = []
        self.running = set()

    def play(self, output, command):
        self.played.append((output, command))
        self.running.add(output)

    def stop(self, output):
        self.stopped.append(output)
        self.running.discard(output)

    def is_running(self, output):
        return output in self.running


class FailingAckCmsClient(FakeCmsClient):
    def ack_command(self, command_id, serial, secret, status, message):
        raise RuntimeError("database timeout")


class FakeMediaCache(MediaCache):
    def __init__(self, root):
        super().__init__(root, 64)
        self.downloaded = []

    def download(self, output, item, timeout_seconds=30):
        self.downloaded.append((output, item["id"]))
        path = self.path_for(output, item)
        path.write_bytes(b"fake-media")
        return path


class AgentRuntimeTest(unittest.TestCase):
    def test_agent_builds_one_session_payload_per_enabled_output(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = self._runtime(Path(directory))

            payloads = runtime.build_session_payloads("idle", "")

        self.assertEqual([payload["serial"] for payload in payloads], ["MK5ABC123A", "MK5ABC123B"])
        self.assertTrue(all(payload["platform"] == "raspberrypi" for payload in payloads))
        self.assertTrue(all(payload["playerType"] == "video_premium" for payload in payloads))
        self.assertEqual(payloads[0]["playerMessage"], "HDMI-A-1 idle")

    def test_poll_once_posts_both_sessions_and_acks_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cms = FakeCmsClient()
            runtime = self._runtime(root, cms)

            runtime.poll_once()

            self.assertEqual([payload["serial"] for payload in cms.sessions], ["MK5ABC123A", "MK5ABC123B"])
            self.assertEqual([ack[0] for ack in cms.acks], ["command-1", "command-1"])
            self.assertEqual(runtime.cache.read_manifest("HDMI-A-1")[0]["id"], "item:0")

    def test_poll_once_downloads_and_starts_first_playable_item(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cms = FakeCmsClient()
            cache = FakeMediaCache(root)
            playback = FakePlaybackController()
            proof = FakeProofReporter()
            runtime = self._runtime(root, cms, cache, playback, proof)

            runtime.poll_once()

            self.assertEqual(
                cache.downloaded,
                [("HDMI-A-1", "item:0"), ("HDMI-A-1", "item:1"), ("HDMI-A-2", "item:0"), ("HDMI-A-2", "item:1")],
            )
            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1", "HDMI-A-2"])
            self.assertIn("--drm-connector=HDMI-A-1", playback.played[0][1])
            self.assertIn("--drm-connector=HDMI-A-2", playback.played[1][1])
            self.assertIn("--loop-playlist=inf", playback.played[0][1])
            self.assertEqual(len([arg for arg in playback.played[0][1] if arg.endswith(".mp4")]), 2)
            self.assertEqual(
                proof.started,
                [
                    ("HDMI-A-1", "MK5ABC123A", ["item:0", "item:1"]),
                    ("HDMI-A-2", "MK5ABC123B", ["item:0", "item:1"]),
                ],
            )

    def test_poll_once_does_not_restart_same_running_item(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            playback = FakePlaybackController()
            proof = FakeProofReporter()
            runtime = self._runtime(root, FakeCmsClient(), cache, playback, proof)

            runtime.poll_once()
            runtime.poll_once()

            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1", "HDMI-A-2"])
            self.assertEqual([entry[0] for entry in proof.started], ["HDMI-A-1", "HDMI-A-2"])

    def test_poll_once_skips_disconnected_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            playback = FakePlaybackController()
            proof = FakeProofReporter()
            runtime = self._runtime(root, FakeCmsClient(), cache, playback, proof)
            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": False}

            runtime.poll_once()

            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1"])
            self.assertEqual(playback.stopped, ["HDMI-A-2"])
            self.assertEqual(proof.stopped, ["HDMI-A-2"])

    def test_poll_once_starts_output_after_hotplug(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            playback = FakePlaybackController()
            runtime = self._runtime(root, FakeCmsClient(), cache, playback)
            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": False}
            runtime.poll_once()

            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": True}
            runtime.poll_once()

            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1", "HDMI-A-2"])

    def test_poll_once_continues_when_command_ack_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cms = FailingAckCmsClient()
            runtime = self._runtime(root, cms)

            with self.assertLogs("signaldeck.agent", level="WARNING") as logs:
                responses = runtime.poll_once()

            self.assertEqual(len(responses), 2)
            self.assertEqual([payload["serial"] for payload in cms.sessions], ["MK5ABC123A", "MK5ABC123B"])
            self.assertTrue(any(log[2] == "command" and "failed to ack" in log[3] for log in cms.logs))
            self.assertTrue(any("failed to ack command" in line for line in logs.output))

    def _runtime(self, root: Path, cms=None, cache=None, playback=None, proof=None):
        config = default_config()
        identity = load_or_create_identity(root / "identity.json", "MK5ABC123", config.outputs)
        return AgentRuntime(
            config,
            identity,
            cms or FakeCmsClient(),
            cache or FakeMediaCache(root),
            playback_controller=playback or FakePlaybackController(),
            proof_reporter=proof or FakeProofReporter(),
        )


if __name__ == "__main__":
    unittest.main()
