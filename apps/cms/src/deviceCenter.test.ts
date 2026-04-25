import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeviceQuickUpdate, filterDeviceCenterDevices, getDeviceConnection, getDeviceType, summarizeDeviceFleet } from "./deviceCenter";
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
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "blackout",
      volumePercent: 35
    });

    assert.deepEqual(buildDeviceQuickUpdate(base, "wake"), {
      name: "Lobby",
      clientId: "client-1",
      channelId: "channel-1",
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "active",
      volumePercent: 35
    });

    assert.deepEqual(buildDeviceQuickUpdate(base, "blackout"), {
      name: "Lobby",
      clientId: "client-1",
      channelId: "channel-1",
      locationLabel: "Recepcja",
      notes: "Test notes",
      desiredDisplayState: "blackout",
      volumePercent: 35
    });
  });

  it("keeps the fleet global until a client, search, or type filter is selected", () => {
    const devices = [
      device({ id: "rpi", name: "AndroidNaRpi", clientId: "client-a", serial: "MKRPI001", platform: "android", deviceModel: "Android on Raspberry Pi" }),
      device({ id: "tv", name: "Lobby TV", clientId: "client-a", serial: "MKTV001", platform: "android", deviceModel: "Android TV" }),
      device({ id: "web", name: "Browser Preview", clientId: "client-b", serial: "MKWEB001", platform: "web", deviceModel: "Chrome" })
    ];

    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "", query: "", type: "" }).map((entry) => entry.id), [
      "rpi",
      "tv",
      "web"
    ]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "client-a", query: "", type: "" }).map((entry) => entry.id), [
      "rpi",
      "tv"
    ]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "", query: "preview", type: "" }).map((entry) => entry.id), ["web"]);
    assert.deepEqual(filterDeviceCenterDevices(devices, { clientId: "client-a", query: "", type: "rpi" }).map((entry) => entry.id), ["rpi"]);
  });

  it("classifies player type from platform and model hints", () => {
    assert.equal(getDeviceType(device({ platform: "android", deviceModel: "Android on Raspberry Pi" })), "rpi");
    assert.equal(getDeviceType(device({ platform: "android", deviceModel: "Android TV" })), "android");
    assert.equal(getDeviceType(device({ platform: "web", deviceModel: "Chrome" })), "web");
    assert.equal(getDeviceType(device({ platform: "linux", deviceModel: "Player Agent" })), "other");
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
