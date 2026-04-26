from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any
import json
import logging
import os
import threading
import time
import uuid

LOGGER = logging.getLogger("signaldeck.proof")


def build_proof_payload(
    serial: str,
    secret: str,
    output: str,
    event_type: str,
    item: dict[str, Any],
    queue_index: int,
    loop_index: int,
    app_version: str,
    occurred_at: str | None = None,
    playback_started_at: str | None = None,
) -> dict[str, Any]:
    occurred = occurred_at or _iso_now()
    started = playback_started_at or occurred
    item_id = str(item.get("id") or "")
    media_id = str(item.get("mediaId") or item.get("media_id") or "")
    playlist_id = str(item.get("playlistId") or item.get("playlist_id") or "")
    event_id = str(item.get("eventId") or item.get("event_id") or "")
    title = str(item.get("title") or "")
    kind = str(item.get("kind") or "unknown")
    source_type = str(item.get("sourceType") or item.get("source_type") or "playlist")
    duration = _positive_float(item.get("durationSeconds"), 0)
    volume = _clamp_int(item.get("volumePercent"), 0, 100)
    local_id = uuid.uuid4().hex
    return {
        "localId": local_id,
        "serial": serial,
        "secret": secret,
        "output": output,
        "eventType": event_type,
        "occurredAt": occurred,
        "playbackStartedAt": started,
        "queueIndex": queue_index,
        "loopIndex": loop_index,
        "itemId": item_id,
        "mediaId": media_id,
        "playlistId": playlist_id,
        "eventId": event_id,
        "title": title,
        "kind": kind,
        "sourceType": source_type,
        "durationSeconds": duration,
        "volumePercent": volume,
        "appVersion": app_version,
        "item": {
            "id": item_id,
            "mediaId": media_id,
            "playlistId": playlist_id,
            "eventId": event_id,
            "title": title,
            "kind": kind,
            "sourceType": source_type,
            "durationSeconds": duration,
            "volumePercent": volume,
        },
    }


class ProofOfPlaySpool:
    def __init__(self, root: str | Path, max_pending: int = 5000):
        self.root = Path(root)
        self.max_pending = max_pending

    def enqueue(self, payload: dict[str, Any]) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        self._prune()
        local_id = str(payload.get("localId") or uuid.uuid4().hex)
        path = self.root / f"{time.time_ns()}-{local_id}.json"
        partial = path.with_suffix(".json.partial")
        partial.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        os.replace(partial, path)
        return path

    def flush(self, sender: Callable[[dict[str, Any]], Any]) -> int:
        sent = 0
        for path in self._pending_files():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                sender(payload)
                path.unlink(missing_ok=True)
                sent += 1
            except Exception as error:
                LOGGER.debug("proof-of-play flush stopped at %s: %s", path, error)
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


class ProofOfPlayReporter:
    def __init__(
        self,
        cms: Any,
        spool_root: str | Path,
        app_version: str,
        sleeper: Callable[[float], None] = time.sleep,
    ):
        self.cms = cms
        self.spool = ProofOfPlaySpool(spool_root)
        self.app_version = app_version
        self.sleeper = sleeper
        self._threads: dict[str, tuple[threading.Event, threading.Thread]] = {}
        self._lock = threading.Lock()

    def start_output(
        self,
        output: str,
        serial: str,
        secret: str,
        queue: list[dict[str, Any]],
        is_running: Callable[[], bool],
    ) -> None:
        self.stop_output(output)
        stop_event = threading.Event()
        thread = threading.Thread(
            target=self._run_output_loop,
            args=(output, serial, secret, list(queue), is_running, stop_event),
            name=f"signaldeck-proof-{output}",
            daemon=True,
        )
        with self._lock:
            self._threads[output] = (stop_event, thread)
        thread.start()

    def stop_output(self, output: str) -> None:
        with self._lock:
            entry = self._threads.pop(output, None)
        if not entry:
            return
        stop_event, thread = entry
        stop_event.set()
        thread.join(timeout=1)

    def report_once(
        self,
        output: str,
        serial: str,
        secret: str,
        queue: list[dict[str, Any]],
        event_type: str,
    ) -> None:
        if not queue:
            return
        payload = build_proof_payload(serial, secret, output, event_type, queue[0], 0, 0, self.app_version)
        self._send_or_spool(payload)

    def flush_pending(self) -> int:
        return self.spool.flush(self.cms.post_proof_of_play)

    def pending_count(self) -> int:
        return self.spool.pending_count()

    def _run_output_loop(
        self,
        output: str,
        serial: str,
        secret: str,
        queue: list[dict[str, Any]],
        is_running: Callable[[], bool],
        stop_event: threading.Event,
    ) -> None:
        loop_index = 0
        playback_started_at = _iso_now()
        self.flush_pending()
        while not stop_event.is_set() and queue and is_running():
            for queue_index, item in enumerate(queue):
                if stop_event.is_set() or not is_running():
                    return
                self._report_item(serial, secret, output, "started", item, queue_index, loop_index, playback_started_at)
                completed = self._wait_for_item(item, stop_event, is_running)
                event_type = "finished" if completed else "interrupted"
                self._report_item(serial, secret, output, event_type, item, queue_index, loop_index, playback_started_at)
                if not completed:
                    return
            loop_index += 1

    def _wait_for_item(self, item: dict[str, Any], stop_event: threading.Event, is_running: Callable[[], bool]) -> bool:
        remaining = _positive_float(item.get("durationSeconds"), 10)
        while remaining > 0:
            if stop_event.is_set() or not is_running():
                return False
            step = min(remaining, 1.0)
            self.sleeper(step)
            remaining -= step
        return True

    def _report_item(
        self,
        serial: str,
        secret: str,
        output: str,
        event_type: str,
        item: dict[str, Any],
        queue_index: int,
        loop_index: int,
        playback_started_at: str,
    ) -> None:
        payload = build_proof_payload(
            serial,
            secret,
            output,
            event_type,
            item,
            queue_index,
            loop_index,
            self.app_version,
            playback_started_at=playback_started_at,
        )
        self._send_or_spool(payload)

    def _send_or_spool(self, payload: dict[str, Any]) -> None:
        try:
            self.cms.post_proof_of_play(payload)
        except Exception as error:
            LOGGER.debug("spooling proof-of-play report %s: %s", payload.get("localId"), error)
            self.spool.enqueue(payload)


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _positive_float(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _clamp_int(value: Any, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = minimum
    return max(minimum, min(maximum, number))
