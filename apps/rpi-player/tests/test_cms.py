import json
import unittest
from io import BytesIO
from urllib.error import HTTPError
from unittest.mock import patch

from signaldeck_rpi.cms import CmsClient


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class CmsClientTest(unittest.TestCase):
    def test_client_posts_session_ack_and_logs(self):
        requests = []
        responses = [
            {"approvalStatus": "pending", "playback": {"mode": "idle", "queue": []}, "commands": []},
            {"command": {"status": "acked"}},
            {"deviceLog": {"message": "Skipped"}},
            {"proofOfPlay": {"id": "proof-1"}},
        ]

        def fake_urlopen(request, timeout):
            requests.append((request.full_url, json.loads(request.data.decode("utf-8")), timeout))
            return FakeResponse(responses.pop(0))

        client = CmsClient("https://cms.example.test", timeout_seconds=2)

        with patch("signaldeck_rpi.cms.urlopen", fake_urlopen):
            session = client.post_session({"serial": "MK1", "secret": "secret"})
            ack = client.ack_command("command-1", "MK1", "secret", "acked", "OK")
            log = client.post_log("MK1", "secret", "warn", "playback", "Skipped")
            proof = client.post_proof_of_play({"serial": "MK1", "secret": "secret", "status": "started"})

        self.assertEqual(session["approvalStatus"], "pending")
        self.assertEqual(ack["command"]["status"], "acked")
        self.assertEqual(log["deviceLog"]["message"], "Skipped")
        self.assertEqual(proof["proofOfPlay"]["id"], "proof-1")
        self.assertEqual(requests[0][0], "https://cms.example.test/api/player/session")
        self.assertEqual(requests[1][0], "https://cms.example.test/api/player/commands/command-1/ack")
        self.assertEqual(requests[2][0], "https://cms.example.test/api/player/logs")
        self.assertEqual(requests[3][0], "https://cms.example.test/api/player/proof-of-play")
        self.assertEqual(requests[2][1]["severity"], "warn")
        self.assertEqual(requests[3][1]["status"], "started")
        self.assertEqual(requests[0][2], 2)

    def test_http_errors_include_status_and_endpoint(self):
        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                500,
                "Internal Server Error",
                {},
                BytesIO(json.dumps({"message": "Serwer napotkał błąd"}).encode("utf-8")),
            )

        client = CmsClient("https://cms.example.test", timeout_seconds=2)

        with patch("signaldeck_rpi.cms.urlopen", fake_urlopen):
            with self.assertRaisesRegex(RuntimeError, r"HTTP 500 .* /api/player/session: Serwer napotkał błąd"):
                client.post_session({"serial": "MK1", "secret": "secret"})


if __name__ == "__main__":
    unittest.main()
