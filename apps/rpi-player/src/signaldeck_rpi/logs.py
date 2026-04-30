from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any
import json
import logging
import os
import time
import uuid

LOGGER = logging.getLogger("signaldeck.logs")


class LogSpool:
    def __init__(self, root: str | Path, max_pending: int = 5000):
        self.root = Path(root)
        self.max_pending = max_pending

    def enqueue(self, payload: dict[str, Any]) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        self._prune()
        local_id = str(payload.get("localId") or uuid.uuid4().hex)
        record = dict(payload)
        record.setdefault("localId", local_id)
        record.setdefault("queuedAt", _iso_now())
        path = self.root / f"{time.time_ns()}-{local_id}.json"
        partial = path.with_suffix(".json.partial")
        partial.write_text(json.dumps(record, sort_keys=True), encoding="utf-8")
        os.replace(partial, path)
        return path

    def flush(self, sender: Callable[[dict[str, Any]], Any], max_items: int | None = None) -> int:
        sent = 0
        pending_files = self._pending_files()
        if max_items is not None:
            pending_files = pending_files[: max(max_items, 0)]
        for path in pending_files:
            try:
                sender(json.loads(path.read_text(encoding="utf-8")))
                path.unlink(missing_ok=True)
                sent += 1
            except Exception as error:
                LOGGER.debug("log flush stopped at %s: %s", path, error)
                break
        return sent

    def pending_count(self) -> int:
        return len(self._pending_files())

    def _pending_files(self) -> list[Path]:
        if not self.root.exists():
            return []
        return sorted(self.root.glob("*.json"))

    def _prune(self) -> None:
        files = self._pending_files()
        overflow = len(files) - max(self.max_pending - 1, 0)
        for path in files[: max(overflow, 0)]:
            path.unlink(missing_ok=True)


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
