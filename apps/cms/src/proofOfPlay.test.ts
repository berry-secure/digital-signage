import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProofOfPlayCsv, filterProofOfPlay, summarizeProofOfPlay } from "./proofOfPlay";
import type { ProofOfPlayRecord } from "./types";

describe("Proof of Play helpers", () => {
  it("filters reports by client, device, status, and search query", () => {
    const records = [
      proof({ id: "started", clientId: "client-a", deviceId: "device-a", locationId: "loc-a", deviceName: "Lobby TV", status: "started" }),
      proof({ id: "finished", clientId: "client-a", deviceId: "device-b", locationId: "loc-b", deviceName: "Menu Board", status: "finished" }),
      proof({ id: "error", clientId: "client-b", deviceId: "device-c", deviceName: "Window", status: "error", mediaTitle: "Promo Fail" })
    ];

    assert.deepEqual(
      filterProofOfPlay(records, { clientId: "client-a", locationId: "", deviceId: "", status: "", query: "" }).map((entry) => entry.id),
      ["started", "finished"]
    );
    assert.deepEqual(
      filterProofOfPlay(records, { clientId: "", locationId: "loc-b", deviceId: "", status: "", query: "" }).map((entry) => entry.id),
      ["finished"]
    );
    assert.deepEqual(
      filterProofOfPlay(records, { clientId: "", locationId: "", deviceId: "device-b", status: "", query: "" }).map((entry) => entry.id),
      ["finished"]
    );
    assert.deepEqual(
      filterProofOfPlay(records, { clientId: "", locationId: "", deviceId: "", status: "error", query: "promo" }).map((entry) => entry.id),
      ["error"]
    );
  });

  it("summarizes proof counters for CMS report tiles", () => {
    const summary = summarizeProofOfPlay([
      proof({ status: "started", deviceId: "a", mediaId: "m1" }),
      proof({ status: "finished", deviceId: "a", mediaId: "m1" }),
      proof({ status: "interrupted", deviceId: "a", mediaId: "m1" }),
      proof({ status: "error", deviceId: "b", mediaId: "m2" })
    ]);

    assert.deepEqual(summary, {
      total: 4,
      started: 1,
      finished: 1,
      interrupted: 1,
      error: 1,
      uniqueDevices: 2,
      uniqueMedia: 2
    });
  });

  it("exports filtered records as CSV with escaped values", () => {
    const csv = buildProofOfPlayCsv([
      proof({ deviceName: "Lobby, TV", mediaTitle: "Promo \"A\"", status: "finished" })
    ]);

    assert.match(csv, /^status,device,serial,client,location,channel,media,source,startedAt,finishedAt,durationSeconds,checksum,contentVersion,errorMessage/);
    assert.match(csv, /"Lobby, TV"/);
    assert.match(csv, /"Promo ""A"""/);
  });
});

function proof(overrides: Partial<ProofOfPlayRecord> = {}): ProofOfPlayRecord {
  return {
    id: "proof-1",
    deviceId: "device-1",
    status: "started",
    sourceType: "playlist",
    playlistId: "playlist-1",
    scheduleId: "",
    mediaId: "media-1",
    playbackItemId: "item-1",
    eventId: "",
    mediaTitle: "Promo",
    mediaKind: "video",
    startedAt: "2026-04-25T00:00:00.000Z",
    finishedAt: "",
    occurredAt: "2026-04-25T00:00:00.000Z",
    durationSeconds: 10,
    checksum: "abc123",
    contentVersion: 1,
    errorMessage: "",
    appVersion: "1.0.1",
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z",
    deviceName: "Lobby TV",
    deviceSerial: "MK123",
    clientId: "client-1",
    clientName: "Client",
    channelId: "channel-1",
    channelName: "Channel",
    locationId: "location-1",
    locationName: "Lobby",
    locationLabel: "Lobby",
    ...overrides
  };
}
