import tempfile
import unittest
import hashlib
from pathlib import Path
from unittest.mock import patch

from signaldeck_rpi.cache import MediaCache, cache_key


class ChunkedResponse:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, size=-1):
        return self.chunks.pop(0) if self.chunks else b""


class CacheTest(unittest.TestCase):
    def test_cache_key_uses_url_and_id_fallback(self):
        key = cache_key({"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"})

        self.assertTrue(key.endswith(".mp4"))
        self.assertEqual(len(key.split(".")[0]), 64)

    def test_cache_key_uses_media_version_and_checksum_when_available(self):
        key = cache_key(
            {
                "mediaId": "media:one",
                "contentVersion": 7,
                "checksum": "a" * 64,
                "url": "https://cms.example.test/uploads/file.mp4",
            }
        )

        self.assertEqual(key, f"media-one-v7-{'a' * 64}.mp4")

    def test_manifest_round_trips_per_output(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            queue = [{"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"}]

            cache.write_manifest("HDMI-A-1", queue)

            self.assertEqual(cache.read_manifest("HDMI-A-1"), queue)

    def test_store_bytes_writes_atomically_without_partial_leftover(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            item = {"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"}

            path = cache.store_bytes("HDMI-A-1", item, b"video-bytes")

            self.assertEqual(path.read_bytes(), b"video-bytes")
            self.assertFalse(path.with_suffix(path.suffix + ".partial").exists())
            self.assertIn("/cache/media/", path.as_posix())

    def test_download_reports_progress_for_each_chunk(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            item = {"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"}
            progress = []

            with patch("signaldeck_rpi.cache.urlopen", return_value=ChunkedResponse([b"one", b"two"])):
                path = cache.download("HDMI-A-1", item, progress=lambda: progress.append("tick"))

            self.assertEqual(path.read_bytes(), b"onetwo")
            self.assertEqual(progress, ["tick", "tick"])

    def test_store_bytes_rejects_sha256_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            checksum = hashlib.sha256(b"expected").hexdigest()
            item = {
                "id": "item:0",
                "checksum": checksum,
                "checksumAlgorithm": "sha256",
                "url": "https://cms.example.test/uploads/file.mp4",
            }

            with self.assertRaises(ValueError):
                cache.store_bytes("HDMI-A-1", item, b"actual")

            self.assertFalse(cache.path_for("HDMI-A-1", item).exists())

    def test_store_bytes_treats_unlabeled_checksum_as_cache_version_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            checksum = hashlib.sha256(b"expected").hexdigest()
            item = {"id": "item:0", "checksum": checksum, "url": "https://cms.example.test/uploads/file.mp4"}

            path = cache.store_bytes("HDMI-A-1", item, b"actual")

            self.assertEqual(path.read_bytes(), b"actual")

    def test_cached_path_finds_legacy_per_output_cache_file(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            item = {"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"}
            legacy_path = cache.output_dir("HDMI-A-1") / cache_key(item)
            legacy_path.write_bytes(b"old-cache")

            self.assertEqual(cache.cached_path("HDMI-A-1", item), legacy_path)


if __name__ == "__main__":
    unittest.main()
