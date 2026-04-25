from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SyncValidationResult:
    compatible: bool
    message: str


@dataclass(frozen=True)
class TimelineSlot:
    output: str
    index: int
    item: dict[str, Any]
    start_monotonic: float
    duration_seconds: float


def validate_clocked_queues(
    left_queue: list[dict[str, Any]],
    right_queue: list[dict[str, Any]],
    tolerance_ms: int,
) -> SyncValidationResult:
    if len(left_queue) != len(right_queue):
        return SyncValidationResult(False, f"sync slot count mismatch: {len(left_queue)} != {len(right_queue)}")

    tolerance_seconds = max(tolerance_ms, 0) / 1000
    for index, (left, right) in enumerate(zip(left_queue, right_queue), start=1):
        left_duration = _duration(left)
        right_duration = _duration(right)
        if abs(left_duration - right_duration) > tolerance_seconds:
            return SyncValidationResult(
                False,
                f"sync duration mismatch at slot {index}: {left_duration:.3f}s != {right_duration:.3f}s",
            )

    return SyncValidationResult(True, "queues are compatible")


def plan_clocked_timeline(
    left_queue: list[dict[str, Any]],
    right_queue: list[dict[str, Any]],
    start_monotonic: float,
    tolerance_ms: int,
) -> dict[str, list[TimelineSlot]]:
    validation = validate_clocked_queues(left_queue, right_queue, tolerance_ms)
    if not validation.compatible:
        raise ValueError(validation.message)

    left_slots: list[TimelineSlot] = []
    right_slots: list[TimelineSlot] = []
    cursor = float(start_monotonic)
    for index, (left, right) in enumerate(zip(left_queue, right_queue)):
        duration = max(_duration(left), _duration(right))
        left_slots.append(TimelineSlot("HDMI-A-1", index, left, cursor, duration))
        right_slots.append(TimelineSlot("HDMI-A-2", index, right, cursor, duration))
        cursor += duration

    return {"HDMI-A-1": left_slots, "HDMI-A-2": right_slots}


def _duration(item: dict[str, Any]) -> float:
    try:
        return float(item.get("durationSeconds") or 0)
    except (TypeError, ValueError):
        return 0.0
