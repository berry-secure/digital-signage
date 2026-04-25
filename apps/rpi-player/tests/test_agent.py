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
                "queue": [{"id": "item:0", "kind": "video", "url": "https://cms.example.test/uploads/clip.mp4", "durationSeconds": 10}],
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

    def _runtime(self, root: Path, cms=None):
        config = default_config()
        identity = load_or_create_identity(root / "identity.json", "MK5ABC123", config.outputs)
        return AgentRuntime(config, identity, cms or FakeCmsClient(), MediaCache(root, 64))


if __name__ == "__main__":
    unittest.main()
