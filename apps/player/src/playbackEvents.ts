import type { PlaybackEntry, PlaybackEvent } from "./types";

export function buildEffectivePlaybackQueue(baseQueue: PlaybackEntry[], events: PlaybackEvent[]) {
  const activeEvents = [...events]
    .filter((event) => event.media)
    .sort((left, right) => Number(left.priority || 100) - Number(right.priority || 100) || left.name.localeCompare(right.name));

  if (!activeEvents.length) {
    return baseQueue.map((entry) => ({ ...entry, sourceType: entry.sourceType || "playlist" }));
  }

  const queue: PlaybackEntry[] = [];
  const eventOccurrences = new Map<string, number>();
  const nextMinuteThreshold = new Map<string, number>();
  let elapsedSeconds = 0;

  for (let index = 0; index < baseQueue.length; index += 1) {
    const baseEntry = { ...baseQueue[index], sourceType: baseQueue[index].sourceType || "playlist" } as PlaybackEntry;
    queue.push(baseEntry);
    elapsedSeconds += Math.max(Number(baseEntry.durationSeconds || 0), 0);

    for (const event of activeEvents) {
      if (shouldInsertEvent(event, index + 1, elapsedSeconds, nextMinuteThreshold)) {
        const occurrence = (eventOccurrences.get(event.id) || 0) + 1;
        eventOccurrences.set(event.id, occurrence);
        queue.push(buildEventEntry(event, occurrence));
      }
    }
  }

  return queue;
}

function shouldInsertEvent(
  event: PlaybackEvent,
  playedItems: number,
  elapsedSeconds: number,
  nextMinuteThreshold: Map<string, number>
) {
  if (event.triggerMode === "items") {
    const intervalItems = Math.max(Number(event.intervalItems || 0), 0);
    return intervalItems > 0 && playedItems % intervalItems === 0;
  }

  const intervalSeconds = Math.max(Number(event.intervalMinutes || 0), 0) * 60;
  if (!intervalSeconds) {
    return false;
  }

  const nextThreshold = nextMinuteThreshold.get(event.id) || intervalSeconds;
  if (elapsedSeconds < nextThreshold) {
    return false;
  }

  nextMinuteThreshold.set(event.id, nextThreshold + intervalSeconds);
  return true;
}

function buildEventEntry(event: PlaybackEvent, occurrence: number): PlaybackEntry {
  return {
    ...event.media,
    id: `event:${event.id}:${occurrence}`,
    title: event.name || event.media.title,
    sourceType: "event",
    eventId: event.id
  };
}
