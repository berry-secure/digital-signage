import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectivePlaybackQueue } from "./playbackEvents";
import type { PlaybackEntry, PlaybackEvent } from "./types";

describe("player playback events", () => {
  it("interleaves visual events after a configured number of playlist items", () => {
    const queue = buildEffectivePlaybackQueue(
      [entry("base-1", 30), entry("base-2", 30), entry("base-3", 30)],
      [
        {
          id: "event-1",
          name: "Promo Splash",
          eventType: "visual",
          triggerMode: "items",
          intervalItems: 2,
          intervalMinutes: 0,
          priority: 10,
          media: entry("promo", 8, "image")
        }
      ]
    );

    assert.deepEqual(
      queue.map((item) => item.id),
      ["base-1", "base-2", "event:event-1:1", "base-3"]
    );
    assert.equal(queue[2].sourceType, "event");
    assert.equal(queue[2].eventId, "event-1");
  });

  it("interleaves audio events after a configured number of elapsed minutes", () => {
    const queue = buildEffectivePlaybackQueue(
      [entry("base-1", 70), entry("base-2", 70), entry("base-3", 70)],
      [
        {
          id: "audio-1",
          name: "Voice alert",
          eventType: "audio",
          triggerMode: "minutes",
          intervalItems: 0,
          intervalMinutes: 2,
          priority: 10,
          media: entry("voice", 12, "audio")
        }
      ]
    );

    assert.deepEqual(
      queue.map((item) => item.id),
      ["base-1", "base-2", "event:audio-1:1", "base-3"]
    );
    assert.equal(queue[2].kind, "audio");
    assert.equal(queue[2].sourceType, "event");
  });
});

function entry(id: string, durationSeconds: number, kind: PlaybackEntry["kind"] = "video"): PlaybackEntry {
  return {
    id,
    playlistId: "playlist-1",
    title: id,
    kind,
    url: `https://cms.example.test/uploads/${id}`,
    durationSeconds,
    volumePercent: 80,
    hasAudio: kind !== "image",
    sourceType: "playlist"
  };
}
