import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeviceQuickUpdate,
  filterDeviceCenterDevices,
  getDeviceConnection,
  getDeviceType,
  getDeviceTypeLabel,
  summarizeDeviceFleet
} from "./deviceCenter";
import type { DeviceRecord } from "./types";

describe("Device Center helpers", () => {
  it("classifies heartbeat state with a five minute stale/offline window", () => {
    assert.equal(getDeviceConnection(device({ online: true, lastSeenAt: "2026-04-25T00:00:00.000Z" }), now()), "online");
    assert.equal(getDeviceConnection(device({ online: false, lastSeenAt: "2026-04-24T23:57:30.000Z" }), now()), "stale");
    assert.equal(getDeviceConnection(device({ online: false, lastSeenAt: "2026-04-24T23:52:00.000Z" }), now()), "offline");
    assert.equal(getDeviceConnection(device({ online: false, lastSeenAt: "" }), now()), "offline");
  });

  it("summarizes pending, online, stale, offline, and blackout devices", () => {
    const summary = summarizeDeviceFleet(
      [
        device({ approvalStatus: "pending" }),
        device({ id: "online", online: true, desiredDisplayState: "active", lastSeenAt: "2026-04-25T00:00:00.000Z" }),
        device({ id: "stale", online: false, desiredDisplayState: "blackout", lastSeenAt: "2026-04-24T23:57:30.000Z" }),
        device({ id: "offline", online: false, desiredDisplayState: "active", lastSeenAt: "2026-04-24T23:52:00.000Z" })
      ],
      now()
    );

    assert.deepEqual(summary, {
      total: 4,
      pending: 1,
      approved: 3,
      online: 1,
      stale: 1,
      offline: 1,
      blackout: 1
    });
  });

  it("builds quick update payloads without dropping required assignment fields", () => {
    const base = device({
      name: "Lobby",
      clientId: "client-1",
      channelId: "channel-1",
      playerType: "video_standard",
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "blackout",
      volumePercent: 35
    });

    assert.deepEqual(buildDeviceQuickUpdate(base, "wake"), {
      name: "Lobby",
      clientId: "client-1",
      channelId: "channel-1",
      playerType: "video_standard",
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "active",
      volumePercent: 35
    });

    assert.deepEqual(buildDeviceQuickUpdate(base, "blackout"), {
      name: "Lobby",
      clientId: "client-1",
      channelId: "channel-1",
      playerType: "video_standard",
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "blackout",
      volumePercent: 35
    });
  });

  it("keeps the fleet global until a client, search, or product type filter is selected", () => {
    const devices = [
      device({ id: "music-mini", name: "Audio Lite", clientId: "client-a", serial: "MKAUDIO001", playerType: "music_mini" }),
      device({ id: "video-standard", name: "Lobby TV", clientId: "client-a", serial: "MKTV001", playerType: "video_standard" }),
      device({ id: "video-premium", name: "Browser Preview", clientId: "client-b", serial: "MKWEB001", playerType: "video_premium" })
    ];

    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "", query: "", type: "" }).map((entry) => entry.id), [
      "music-mini",
      "video-standard",
      "video-premium"
    ]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "client-a", query: "", type: "" }).map((entry) => entry.id), [
      "music-mini",
      "video-standard"
    ]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "", query: "preview", type: "" }).map((entry) => entry.id), [
      "video-premium"
    ]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "client-a", query: "", type: "music_mini" }).map((entry) => entry.id), [
      "music-mini"
    ]);
  });

  it("classifies and labels the full player product type list from the assigned CMS field", () => {
    const expected = [
      ["music_mini", "Music Mini"],
      ["music_max", "Music Max"],
      ["video_standard", "Video Standard"],
      ["video_premium", "Video Premium"],
      ["streaming", "Streaming"],
      ["android_tv", "AndroidTV"],
      ["mobile_app", "MobileApp"]
    ] as const;

    for (const [playerType, label] of expected) {
      const entry = device({ playerType });
      assert.equal(getDeviceType(entry), playerType);
      assert.equal(getDeviceTypeLabel(entry), label);
    }

    assert.equal(getDeviceType(device({ playerType: "" })), "video_standard");
  });
});

function now() {
  return new Date("2026-04-25T00:00:00.000Z");
}

function device(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: "device-1",
    serial: "MK123456789AB",
    secret: "secret",
    approvalStatus: "approved",
    name: "Android TV",
    clientId: "client-1",
    channelId: "channel-1",
    locationLabel: "",
    notes: "",
    platform: "android",
    appVersion: "1.0.1",
    deviceModel: "Android TV",
    playerType: "video_standard",
    desiredDisplayState: "active",
    volumePercent: 80,
    playerState: "idle",
    playerMessage: "",
    activeItemTitle: "",
    lastSeenAt: "2026-04-25T00:00:00.000Z",
    lastSyncAt: "",
    lastPlaybackAt: "",
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z",
    clientName: "Client",
    channelName: "Channel",
    online: false,
    ...overrides
  };
}
