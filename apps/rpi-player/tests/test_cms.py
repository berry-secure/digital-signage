import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from signaldeck_rpi.cms import CmsClient


class CmsClientTest(unittest.TestCase):
    def test_client_posts_session_ack_and_logs(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                received.append((self.path, body))
                self.send_response(200 if "/logs" not in self.path else 201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                if self.path == "/api/player/session":
                    payload = {"approvalStatus": "pending", "playback": {"mode": "idle", "queue": []}, "commands": []}
                elif self.path.endswith("/ack"):
                    payload = {"command": {"status": body["status"]}}
                else:
                    payload = {"deviceLog": {"message": body["message"]}}
                self.wfile.write(json.dumps(payload).encode("utf-8"))

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        client = CmsClient(f"http://127.0.0.1:{server.server_port}", timeout_seconds=2)

        session = client.post_session({"serial": "MK1", "secret": "secret"})
        ack = client.ack_command("command-1", "MK1", "secret", "acked", "OK")
        log = client.post_log("MK1", "secret", "warn", "playback", "Skipped")

        self.assertEqual(session["approvalStatus"], "pending")
        self.assertEqual(ack["command"]["status"], "acked")
        self.assertEqual(log["deviceLog"]["message"], "Skipped")
        self.assertEqual(received[0][0], "/api/player/session")
        self.assertEqual(received[1][0], "/api/player/commands/command-1/ack")
        self.assertEqual(received[2][0], "/api/player/logs")


if __name__ == "__main__":
    unittest.main()
