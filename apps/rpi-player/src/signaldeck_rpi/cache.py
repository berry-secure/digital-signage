from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.request import urlopen
import hashlib
import json
import os
import re


def cache_key(item: dict[str, Any]) -> str:
    media_id = str(item.get("mediaId") or item.get("media_id") or "").strip()
    content_version = str(item.get("contentVersion") or item.get("content_version") or "").strip()
    checksum = str(item.get("checksum") or "").strip().lower()
    extension = _extension(str(item.get("url") or ""))
    if media_id and content_version and checksum:
        return f"{_slug(media_id)}-v{_slug(content_version)}-{_slug(checksum)}{extension}"
    source = str(item.get("checksum") or item.get("contentVersion") or f"{item.get('id', '')}:{item.get('url', '')}")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    return f"{digest}{extension}"


class MediaCache:
    def __init__(self, root: str | Path, cache_limit_mb: int):
        self.root = Path(root)
        self.cache_limit_mb = cache_limit_mb

    def output_dir(self, output: str) -> Path:
        path = self.root / "cache" / output
        path.mkdir(parents=True, exist_ok=True)
        return path

    def media_dir(self) -> Path:
        path = self.root / "cache" / "media"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def manifests_dir(self) -> Path:
        path = self.root / "manifests"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def path_for(self, output: str, item: dict[str, Any]) -> Path:
        return self.media_dir() / cache_key(item)

    def cached_path(self, output: str, item: dict[str, Any]) -> Path | None:
        path = self.path_for(output, item)
        return path if path.exists() else None

    def store_bytes(self, output: str, item: dict[str, Any], data: bytes) -> Path:
        destination = self.path_for(output, item)
        partial = destination.with_suffix(destination.suffix + ".partial")
        partial.write_bytes(data)
        try:
            _verify_checksum(item, data)
        except Exception:
            partial.unlink(missing_ok=True)
            raise
        os.replace(partial, destination)
        return destination

    def download(self, output: str, item: dict[str, Any], timeout_seconds: int = 30) -> Path:
        destination = self.path_for(output, item)
        if destination.exists():
            try:
                _verify_checksum(item, destination.read_bytes())
                return destination
            except ValueError:
                destination.unlink(missing_ok=True)
        url = str(item.get("url") or "")
        if not url:
            raise ValueError("media item does not contain a url")
        partial = destination.with_suffix(destination.suffix + ".partial")
        with urlopen(url, timeout=timeout_seconds) as response:
            data = response.read()
        partial.write_bytes(data)
        try:
            _verify_checksum(item, data)
        except Exception:
            partial.unlink(missing_ok=True)
            raise
        os.replace(partial, destination)
        return destination

    def write_manifest(self, output: str, queue: list[dict[str, Any]]) -> Path:
        destination = self.manifests_dir() / f"{output}.json"
        partial = destination.with_suffix(".json.partial")
        partial.write_text(json.dumps(queue, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(partial, destination)
        return destination

    def read_manifest(self, output: str) -> list[dict[str, Any]]:
        path = self.manifests_dir() / f"{output}.json"
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []


def _extension(url: str) -> str:
    clean_url = url.split("?", 1)[0].split("#", 1)[0]
    suffix = Path(clean_url).suffix.lower()
    if suffix and len(suffix) <= 12:
        return suffix
    return ".bin"


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "unknown"


def _verify_checksum(item: dict[str, Any], data: bytes) -> None:
    checksum = str(item.get("checksum") or "").strip().lower()
    if not checksum or not re.fullmatch(r"[a-f0-9]{32}|[a-f0-9]{64}", checksum):
        return
    algorithm = hashlib.sha256 if len(checksum) == 64 else hashlib.md5
    actual = algorithm(data).hexdigest()
    if actual != checksum:
        raise ValueError(f"checksum mismatch for media {item.get('mediaId') or item.get('id') or 'unknown'}")
