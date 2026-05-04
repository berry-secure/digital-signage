import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlaylistDraftItem,
  buildPlaylistDraftItemFromMedia,
  detectMediaKind,
  getDefaultDurationSeconds,
  playlistSortOrder,
  reorderPlaylistDraftItems
} from "./playlistBuilder";

describe("playlist builder helpers", () => {
  it("detects visual and audio media from MIME type and file extension", () => {
    assert.equal(detectMediaKind(file("promo.mp4", "video/mp4")), "video");
    assert.equal(detectMediaKind(file("poster.PNG", "")), "image");
    assert.equal(detectMediaKind(file("jingle.wav", "audio/wav")), "audio");
    assert.equal(detectMediaKind(file("notes.pdf", "application/pdf")), "");
  });

  it("uses native duration when known and safe fallbacks otherwise", () => {
    assert.equal(buildPlaylistDraftItem({ id: "video", file: file("promo.mp4", "video/mp4"), durationSeconds: 42 })?.durationSeconds, 42);
    assert.equal(buildPlaylistDraftItem({ id: "image", file: file("poster.jpg", "image/jpeg") })?.durationSeconds, 10);
    assert.equal(buildPlaylistDraftItem({ id: "audio", file: file("track.mp3", "audio/mpeg") })?.durationSeconds, 180);
    assert.equal(getDefaultDurationSeconds("video"), 10);
  });

  it("builds editable draft rows from existing playlist media", () => {
    assert.deepEqual(
      buildPlaylistDraftItemFromMedia({
        id: "existing-item",
        title: "Menu Board",
        kind: "image",
        mimeType: "image/png",
        durationSeconds: 0,
        hasAudio: true,
        previewUrl: "https://cms.example.test/uploads/menu.png"
      }),
      {
        id: "existing-item",
        title: "Menu Board",
        kind: "image",
        mimeType: "image/png",
        durationSeconds: 10,
        hasAudio: false,
        previewUrl: "https://cms.example.test/uploads/menu.png"
      }
    );
  });

  it("reorders draft items and keeps playlist sort numbers spaced by ten", () => {
    const items = [
      buildPlaylistDraftItem({ id: "a", file: file("a.mp4", "video/mp4") }),
      buildPlaylistDraftItem({ id: "b", file: file("b.mp4", "video/mp4") }),
      buildPlaylistDraftItem({ id: "c", file: file("c.mp4", "video/mp4") })
    ].filter(Boolean);

    assert.deepEqual(reorderPlaylistDraftItems(items, "c", "a").map((entry) => entry.id), ["c", "a", "b"]);
    assert.equal(playlistSortOrder(0), 10);
    assert.equal(playlistSortOrder(2), 30);
  });
});

function file(name: string, type: string) {
  return { name, type };
}
