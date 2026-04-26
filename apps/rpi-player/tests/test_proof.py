import tempfile
import unittest
from pathlib import Path

from signaldeck_rpi.proof import ProofOfPlayReporter, ProofOfPlaySpool, build_proof_payload


class FakeCms:
    def __init__(self, fail=False):
        self.fail = fail
        self.reports = []

    def post_proof_of_play(self, payload):
        if self.fail:
            raise RuntimeError("cms offline")
        self.reports.append(payload)
        return {"proofOfPlay": {"id": "proof-1"}}


class ProofOfPlayTest(unittest.TestCase):
    def test_build_proof_payload_keeps_player_and_media_context(self):
        payload = build_proof_payload(
            serial="MK5ABC123A",
            secret="secret",
            output="HDMI-A-1",
            event_type="started",
            item={
                "id": "playlist-item-1:0",
                "mediaId": "media-1",
                "playlistId": "playlist-1",
                "eventId": "event-1",
                "title": "Promo",
                "kind": "video",
                "sourceType": "playlist",
                "durationSeconds": 10,
                "volumePercent": 80,
            },
            queue_index=1,
            loop_index=2,
            app_version="rpi-video-premium-0.1.0",
            occurred_at="2026-04-26T12:00:00Z",
            playback_started_at="2026-04-26T11:59:50Z",
        )

        self.assertEqual(payload["serial"], "MK5ABC123A")
        self.assertEqual(payload["output"], "HDMI-A-1")
        self.assertEqual(payload["eventType"], "started")
        self.assertEqual(payload["itemId"], "playlist-item-1:0")
        self.assertEqual(payload["mediaId"], "media-1")
        self.assertEqual(payload["playlistId"], "playlist-1")
        self.assertEqual(payload["eventId"], "event-1")
        self.assertEqual(payload["loopIndex"], 2)
        self.assertEqual(payload["item"]["title"], "Promo")

    def test_spool_flushes_pending_reports_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = ProofOfPlaySpool(Path(directory), max_pending=10)
            spool.enqueue({"localId": "b", "eventType": "finished"})
            spool.enqueue({"localId": "a", "eventType": "started"})
            cms = FakeCms()

            sent = spool.flush(cms.post_proof_of_play)

            self.assertEqual(sent, 2)
            self.assertEqual([report["eventType"] for report in cms.reports], ["finished", "started"])
            self.assertEqual(spool.pending_count(), 0)

    def test_reporter_spools_when_cms_rejects_report(self):
        with tempfile.TemporaryDirectory() as directory:
            reporter = ProofOfPlayReporter(FakeCms(fail=True), Path(directory), "app")

            reporter.report_once(
                "HDMI-A-1",
                "MK5ABC123A",
                "secret",
                [{"id": "item-1", "kind": "video", "durationSeconds": 10}],
                "started",
            )

            self.assertEqual(reporter.pending_count(), 1)


if __name__ == "__main__":
    unittest.main()
