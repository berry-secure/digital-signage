import tempfile
import unittest
import hashlib
from pathlib import Path

from signaldeck_rpi.cache import MediaCache, cache_key


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

    def test_store_bytes_rejects_sha256_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = MediaCache(Path(directory), cache_limit_mb=64)
            checksum = hashlib.sha256(b"expected").hexdigest()
            item = {"id": "item:0", "checksum": checksum, "url": "https://cms.example.test/uploads/file.mp4"}

            with self.assertRaises(ValueError):
                cache.store_bytes("HDMI-A-1", item, b"actual")

            self.assertFalse(cache.path_for("HDMI-A-1", item).exists())


if __name__ == "__main__":
    unittest.main()
