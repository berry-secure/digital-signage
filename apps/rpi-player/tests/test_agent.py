import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from signaldeck_rpi.agent import AgentRuntime
from signaldeck_rpi.cache import MediaCache
from signaldeck_rpi.cms import CmsClient
from signaldeck_rpi.config import OutputConfig, default_config, load_config
from signaldeck_rpi.identity import load_or_create_identity
from signaldeck_rpi.logs import LogSpool


class FakeCmsClient(CmsClient):
    def __init__(self):
        self.sessions = []
        self.acks = []
        self.logs = []

    def post_session(self, payload):
        self.sessions.append(payload)
        device_index = len(self.sessions)
        return {
            "approvalStatus": "approved",
            "device": {"id": f"device-{device_index}", "approvalStatus": "approved", "desiredDisplayState": "active"},
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

    def post_log_payload(self, payload):
        self.logs.append(
            (
                payload["serial"],
                payload["severity"],
                payload["component"],
                payload["message"],
                {"context": payload.get("context", {})},
            )
        )
        return {"deviceLog": {"message": payload["message"]}}


class FakeProofReporter:
    def __init__(self):
        self.started = []
        self.stopped = []
        self.flushed = 0

    def start_output(self, output, serial, secret, device_id, queue, is_running):
        self.started.append((output, serial, device_id, [item["id"] for item in queue]))

    def stop_output(self, output):
        self.stopped.append(output)

    def flush_pending(self, max_items=None, progress=None):
        if progress:
            progress()
        self.flushed += 1
        return 0


class OrderedProofReporter(FakeProofReporter):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def flush_pending(self, max_items=None, progress=None):
        if progress:
            progress()
        self.events.append(("proof_flush", max_items))
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


class OrderedPlaybackController(FakePlaybackController):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def play(self, output, command):
        self.events.append(("play", output))
        super().play(output, command)


class OrderedLogSpool:
    def __init__(self, events):
        self.events = events

    def flush(self, sender, max_items=None, progress=None):
        if progress:
            progress()
        self.events.append(("log_flush", max_items))
        return 0


class FailingAckCmsClient(FakeCmsClient):
    def ack_command(self, command_id, serial, secret, status, message):
        raise RuntimeError("database timeout")


class FailingLogCmsClient(FakeCmsClient):
    def post_log_payload(self, payload):
        raise RuntimeError("cms offline")


class OfflineCmsClient(FakeCmsClient):
    def post_session(self, payload):
        self.sessions.append(payload)
        raise RuntimeError("network offline")


class ServerUrlCommandCmsClient(FakeCmsClient):
    def post_session(self, payload):
        response = super().post_session(payload)
        response["commands"] = [
            {"id": "server-url-command", "type": "set_server_url", "payload": {"serverUrl": "https://maasck-ds.online/"}}
        ]
        return response


class AudioCmsClient(FakeCmsClient):
    def post_session(self, payload):
        response = super().post_session(payload)
        response["playback"]["queue"][0]["hasAudio"] = True
        return response


class FakeMediaCache(MediaCache):
    def __init__(self, root):
        super().__init__(root, 64)
        self.downloaded = []

    def download(self, output, item, timeout_seconds=30, progress=None):
        self.downloaded.append((output, item["id"]))
        if progress:
            progress()
        path = self.path_for(output, item)
        path.write_bytes(b"fake-media")
        return path


class FailingMediaCache(FakeMediaCache):
    def download(self, output, item, timeout_seconds=30, progress=None):
        if item["id"] == "item:1":
            raise RuntimeError("download failed")
        return super().download(output, item, timeout_seconds, progress=progress)


class AgentRuntimeTest(unittest.TestCase):
    def test_agent_builds_one_session_payload_per_enabled_output(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = self._runtime(Path(directory))

            payloads = runtime.build_session_payloads("idle", "")

        self.assertEqual([payload["serial"] for payload in payloads], ["MK5ABC123A", "MK5ABC123B"])
        self.assertTrue(all(payload["platform"] == "rpi" for payload in payloads))
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
            self.assertIn("--no-audio", playback.played[0][1])
            self.assertEqual(len([arg for arg in playback.played[0][1] if arg.endswith(".mp4")]), 2)
            self.assertEqual(
                proof.started,
                [
                    ("HDMI-A-1", "MK5ABC123A", "device-1", ["item:0", "item:1"]),
                    ("HDMI-A-2", "MK5ABC123B", "device-2", ["item:0", "item:1"]),
                ],
            )

    def test_poll_once_keeps_audio_enabled_when_manifest_declares_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            playback = FakePlaybackController()
            runtime = self._runtime(root, AudioCmsClient(), FakeMediaCache(root), playback)

            runtime.poll_once()

            self.assertNotIn("--no-audio", playback.played[0][1])

    def test_poll_once_starts_playback_before_flushing_backlog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = []
            cache = FakeMediaCache(root)
            playback = OrderedPlaybackController(events)
            proof = OrderedProofReporter(events)
            log_spool = OrderedLogSpool(events)
            runtime = self._runtime(root, FakeCmsClient(), cache, playback, proof, log_spool=log_spool)

            runtime.poll_once()

            self.assertEqual(events[:2], [("play", "HDMI-A-1"), ("play", "HDMI-A-2")])
            self.assertEqual(events[2:], [("proof_flush", 20), ("log_flush", 20)])

    def test_poll_once_notifies_watchdog_during_sync(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ticks = []
            runtime = self._runtime(root, watchdog=lambda: ticks.append("tick"))

            runtime.poll_once()

            self.assertGreaterEqual(len(ticks), 5)

    def test_poll_once_notifies_watchdog_while_flushing_backlog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ticks = []
            proof = FakeProofReporter()
            log_spool = OrderedLogSpool([])
            runtime = self._runtime(root, proof=proof, log_spool=log_spool, watchdog=lambda: ticks.append("tick"))

            runtime.poll_once()

            self.assertGreaterEqual(proof.flushed, 1)
            self.assertGreaterEqual(len(ticks), 7)

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
            self.assertEqual([entry[2] for entry in proof.started], ["device-1", "device-2"])

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

    def test_poll_once_plays_cached_manifest_when_session_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            cached_queue = [{"id": "cached:0", "kind": "video", "url": "https://cms.example.test/uploads/cached.mp4", "durationSeconds": 10}]
            cache.write_manifest("HDMI-A-1", cached_queue)
            cache.store_bytes("HDMI-A-1", cached_queue[0], b"cached-media")
            playback = FakePlaybackController()
            proof = FakeProofReporter()
            runtime = self._runtime(root, OfflineCmsClient(), cache, playback, proof)
            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": False}

            runtime.poll_once()

            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1"])
            self.assertEqual(proof.started, [("HDMI-A-1", "MK5ABC123A", "", ["cached:0"])])
            self.assertEqual(len([arg for arg in playback.played[0][1] if arg.endswith(".mp4")]), 1)
            self.assertEqual(cache.downloaded, [])

    def test_poll_once_plays_cached_media_files_when_session_fails_without_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            media_path = cache.media_dir() / "orphaned.mp4"
            media_path.write_bytes(b"cached-media")
            playback = FakePlaybackController()
            proof = FakeProofReporter()
            runtime = self._runtime(root, OfflineCmsClient(), cache, playback, proof)
            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": False}

            runtime.poll_once()

            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1"])
            self.assertIn(str(media_path), playback.played[0][1])
            self.assertIn("--no-audio", playback.played[0][1])
            self.assertEqual(proof.started, [("HDMI-A-1", "MK5ABC123A", "", ["cached-file:orphaned.mp4"])])

    def test_start_cached_playback_plays_manifest_without_polling_cms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FakeMediaCache(root)
            cached_queue = [{"id": "cached:0", "kind": "video", "url": "https://cms.example.test/uploads/cached.mp4", "durationSeconds": 10}]
            cache.write_manifest("HDMI-A-1", cached_queue)
            cache.store_bytes("HDMI-A-1", cached_queue[0], b"cached-media")
            cms = FakeCmsClient()
            playback = FakePlaybackController()
            runtime = self._runtime(root, cms, cache, playback)
            runtime.connector_status = {"HDMI-A-1": True, "HDMI-A-2": False}

            runtime.start_cached_playback()

            self.assertEqual(cms.sessions, [])
            self.assertEqual([entry[0] for entry in playback.played], ["HDMI-A-1"])

    def test_poll_once_keeps_previous_manifest_when_new_download_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = FailingMediaCache(root)
            playback = FakePlaybackController()
            runtime = self._runtime(root, FakeCmsClient(), cache, playback)

            runtime.poll_once()

            self.assertEqual(cache.read_manifest("HDMI-A-1"), [])
            self.assertEqual(playback.played, [])

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

    def test_log_spool_keeps_logs_when_cms_is_offline_and_flushes_on_reconnect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spool = LogSpool(root / "queue" / "logs")
            runtime = self._runtime(root, FailingLogCmsClient(), log_spool=spool)

            runtime._log("MK5ABC123A", "secret", "warn", "network", "offline", {"output": "HDMI-A-1"})

            self.assertEqual(spool.pending_count(), 1)

            cms = FakeCmsClient()
            runtime.cms = cms
            runtime._flush_pending()

            self.assertEqual(spool.pending_count(), 0)
            self.assertEqual(cms.logs[0][2], "network")
            self.assertEqual(cms.logs[0][3], "offline")

    def test_poll_once_applies_server_url_command_after_ack(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "player.toml"
            config_path.write_text(
                'server_url = "https://legacy.example.test"\n[[outputs]]\nname = "HDMI-A-1"\nserial_suffix = "A"\nenabled = true\n',
                encoding="utf-8",
            )
            identity_path = root / "identity.json"
            commands = []
            config = replace(load_config(config_path), outputs=[OutputConfig("HDMI-A-1", "A", True)])
            before_identity = load_or_create_identity(identity_path, "MK5ABC123", config.outputs)
            runtime = self._runtime(
                root,
                ServerUrlCommandCmsClient(),
                config=config,
                config_path=config_path,
                identity_path=identity_path,
                runner=lambda command, allow_failure=False: commands.append((command, allow_failure)),
            )

            runtime.poll_once()

            after_identity = load_or_create_identity(identity_path, "DIFFERENT", config.outputs)
            self.assertIn('server_url = "https://maasck-ds.online"', config_path.read_text(encoding="utf-8"))
            self.assertEqual(runtime.config.server_url, "https://maasck-ds.online")
            self.assertEqual(after_identity.outputs["HDMI-A-1"].serial, before_identity.outputs["HDMI-A-1"].serial)
            self.assertEqual(after_identity.outputs["HDMI-A-1"].secret, before_identity.outputs["HDMI-A-1"].secret)
            self.assertEqual(runtime.cms.acks[0][0], "server-url-command")
            self.assertEqual(runtime.cms.acks[0][2], "acked")
            self.assertEqual(commands, [(["bash", "-lc", "(sleep 1; systemctl restart signaldeck-agent.service) >/dev/null 2>&1 &"], True)])

    def _runtime(
        self,
        root: Path,
        cms=None,
        cache=None,
        playback=None,
        proof=None,
        log_spool=None,
        config=None,
        config_path=None,
        identity_path=None,
        runner=None,
        watchdog=None,
    ):
        config = config or default_config()
        identity = load_or_create_identity(identity_path or root / "identity.json", "MK5ABC123", config.outputs)
        return AgentRuntime(
            config,
            identity,
            cms or FakeCmsClient(),
            cache or FakeMediaCache(root),
            playback_controller=playback or FakePlaybackController(),
            proof_reporter=proof or FakeProofReporter(),
            log_spool=log_spool,
            config_path=config_path or root / "player.toml",
            runner=runner or (lambda command, allow_failure=False: None),
            watchdog=watchdog,
        )


if __name__ == "__main__":
    unittest.main()
