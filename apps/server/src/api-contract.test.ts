import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "./app.js";

describe("MVP API contract", () => {
  let dataDir = "";
  let app: Awaited<ReturnType<typeof createApp>>;

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "signal-deck-api-"));
    app = await createApp({
      dataDir,
      adminEmail: "owner@example.test",
      adminPassword: "strong-password",
      adminName: "Owner Test",
      publicBaseUrl: "https://cms.example.test"
    });
  });

  after(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps the CMS login and bootstrap response shape stable", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.test", password: "strong-password" });

    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, "string");
    assert.equal(login.body.user.email, "owner@example.test");
    assert.equal(login.body.user.role, "owner");

    const bootstrap = await request(app).get("/api/bootstrap").set("Authorization", `Bearer ${login.body.token}`);

    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.user.email, "owner@example.test");
    assert.ok(Array.isArray(bootstrap.body.users));
    assert.ok(Array.isArray(bootstrap.body.clients));
    assert.ok(Array.isArray(bootstrap.body.channels));
    assert.ok(Array.isArray(bootstrap.body.media));
    assert.ok(Array.isArray(bootstrap.body.playlists));
    assert.ok(Array.isArray(bootstrap.body.schedules));
    assert.ok(Array.isArray(bootstrap.body.devices));
    assert.equal(bootstrap.body.installation.apiBaseUrl, "https://cms.example.test");
    assert.equal(bootstrap.body.installation.apkUrl, "https://cms.example.test/app/maasck.apk");
  });

  it("keeps first Android TV player session pending with idle playback", async () => {
    const playerSession = await request(app)
      .post("/api/player/session")
      .send({
        serial: "MK123456789AB",
        secret: "local-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting",
        playerMessage: "Player startuje",
        activeItemTitle: ""
      });

    assert.equal(playerSession.status, 200);
    assert.equal(playerSession.body.approvalStatus, "pending");
    assert.equal(playerSession.body.device.serial, "MK123456789AB");
    assert.equal(playerSession.body.device.approvalStatus, "pending");
    assert.equal(playerSession.body.device.platform, "android");
    assert.equal(playerSession.body.playback.mode, "idle");
    assert.deepEqual(playerSession.body.playback.queue, []);
    assert.equal(playerSession.body.playback.fallbackUsed, false);
    assert.equal(typeof playerSession.body.serverTime, "string");
  });

  it("can boot through Prisma persistence when a database client is configured", async () => {
    const calls: string[] = [];
    const prisma = createFakePrisma(calls);
    const prismaApp = await createApp({
      databaseUrl: "postgresql://signal:deck@localhost:5432/signaldeck",
      prismaClient: prisma,
      adminEmail: "prisma-owner@example.test",
      adminPassword: "strong-password",
      adminName: "Prisma Owner",
      publicBaseUrl: "https://cms.example.test"
    });

    assert.ok(calls.includes("user.findMany"));
    assert.ok(calls.includes("$transaction"));
    assert.ok(calls.includes("user.createMany"));

    const login = await request(prismaApp)
      .post("/api/auth/login")
      .send({ email: "prisma-owner@example.test", password: "strong-password" });

    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, "prisma-owner@example.test");
  });

  it("allows only owners to manage CMS users", async () => {
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-rbac-"));
    const isolatedApp = await createApp({
      dataDir: isolatedDataDir,
      adminEmail: "rbac-owner@example.test",
      adminPassword: "strong-password",
      adminName: "RBAC Owner"
    });

    const ownerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "rbac-owner@example.test", password: "strong-password" });
    const ownerToken = ownerLogin.body.token;

    const managerCreate = await request(isolatedApp)
      .post("/api/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "manager@example.test",
        password: "manager-password",
        name: "Manager",
        role: "manager"
      });

    assert.equal(managerCreate.status, 201);

    const managerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "manager@example.test", password: "manager-password" });
    const managerToken = managerLogin.body.token;

    const forbidden = await request(isolatedApp)
      .post("/api/users")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        email: "editor@example.test",
        password: "editor-password",
        name: "Editor",
        role: "editor"
      });

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.message, "Brak uprawnień do zarządzania użytkownikami.");

    await rm(isolatedDataDir, { recursive: true, force: true });
  });

  it("queues live commands for a player session and accepts command ACK", async () => {
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-commands-"));
    const isolatedApp = await createApp({
      dataDir: isolatedDataDir,
      adminEmail: "commands-owner@example.test",
      adminPassword: "strong-password",
      adminName: "Commands Owner"
    });

    const ownerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "commands-owner@example.test", password: "strong-password" });
    const ownerToken = ownerLogin.body.token;

    const client = await request(isolatedApp)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Live Commands Client" });
    const channel = await request(isolatedApp)
      .post("/api/channels")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: client.body.client.id, name: "Main Floor" });

    const playerSession = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKCOMMAND001",
        secret: "command-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting"
      });

    const approved = await request(isolatedApp)
      .post("/api/devices/approve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        deviceId: playerSession.body.device.id,
        serial: "MKCOMMAND001",
        name: "Command Screen",
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        locationLabel: "Lobby",
        notes: "",
        playerType: "mobile_app",
        desiredDisplayState: "active",
        volumePercent: 70
      });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.device.playerType, "mobile_app");

    const queued = await request(isolatedApp)
      .post(`/api/devices/${approved.body.device.id}/commands`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        type: "set_volume",
        payload: { volumePercent: 33 }
      });

    assert.equal(queued.status, 201);
    assert.equal(queued.body.command.status, "pending");
    assert.equal(queued.body.command.type, "set_volume");
    assert.deepEqual(queued.body.command.payload, { volumePercent: 33 });
    assert.equal(queued.body.device.volumePercent, 33);

    const commandSession = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKCOMMAND001",
        secret: "command-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "idle"
      });

    assert.equal(commandSession.status, 200);
    assert.equal(commandSession.body.commands.length, 1);
    assert.equal(commandSession.body.commands[0].id, queued.body.command.id);
    assert.equal(commandSession.body.commands[0].type, "set_volume");

    const ack = await request(isolatedApp)
      .post(`/api/player/commands/${queued.body.command.id}/ack`)
      .send({
        serial: "MKCOMMAND001",
        secret: "command-secret",
        status: "acked",
        message: "Volume applied"
      });

    assert.equal(ack.status, 200);
    assert.equal(ack.body.command.status, "acked");
    assert.equal(ack.body.command.message, "Volume applied");

    const bootstrap = await request(isolatedApp).get("/api/bootstrap").set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(bootstrap.body.deviceCommands[0].status, "acked");
    assert.equal(bootstrap.body.deviceCommands[0].deviceName, "Command Screen");

    await rm(isolatedDataDir, { recursive: true, force: true });
  });

  it("records device logs and interleaves playback events into player queues", async () => {
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-events-"));
    const isolatedApp = await createApp({
      dataDir: isolatedDataDir,
      adminEmail: "events-owner@example.test",
      adminPassword: "strong-password",
      adminName: "Events Owner",
      publicBaseUrl: "https://cms.example.test"
    });

    const ownerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "events-owner@example.test", password: "strong-password" });
    const ownerToken = ownerLogin.body.token;

    const client = await request(isolatedApp)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Events Client" });
    const channel = await request(isolatedApp)
      .post("/api/channels")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: client.body.client.id, name: "Main Channel" });

    const playlistMedia = await uploadTestMedia(isolatedApp, ownerToken, {
      clientId: client.body.client.id,
      title: "Base Clip",
      kind: "video",
      fileName: "base.mp4",
      mimeType: "video/mp4",
      durationSeconds: 30
    });
    const visualEventMedia = await uploadTestMedia(isolatedApp, ownerToken, {
      clientId: client.body.client.id,
      title: "Promo Splash",
      kind: "image",
      fileName: "promo.png",
      mimeType: "image/png",
      durationSeconds: 8
    });

    const playlist = await request(isolatedApp)
      .post("/api/playlists")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        name: "Main Playlist",
        isActive: true,
        notes: ""
      });

    await request(isolatedApp)
      .post(`/api/playlists/${playlist.body.playlist.id}/items`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        mediaId: playlistMedia.body.media.id,
        sortOrder: 10,
        loopCount: 2,
        volumePercent: 80
      });

    const playbackEvent = await request(isolatedApp)
      .post("/api/playback-events")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        mediaId: visualEventMedia.body.media.id,
        name: "Promo event",
        eventType: "visual",
        triggerMode: "items",
        intervalItems: 1,
        intervalMinutes: 0,
        priority: 10,
        isActive: true
      });

    assert.equal(playbackEvent.status, 201);
    assert.equal(playbackEvent.body.playbackEvent.eventType, "visual");

    const playerSession = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKEVENT001",
        secret: "event-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting"
      });

    const approved = await request(isolatedApp)
      .post("/api/devices/approve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        deviceId: playerSession.body.device.id,
        serial: "MKEVENT001",
        name: "Event Screen",
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        locationLabel: "Lobby",
        notes: "",
        playerType: "video_standard",
        desiredDisplayState: "active",
        volumePercent: 80
      });

    const logged = await request(isolatedApp)
      .post("/api/player/logs")
      .send({
        serial: "MKEVENT001",
        secret: "event-secret",
        severity: "error",
        component: "playback",
        message: "Media failed to start",
        stack: "Error: decode failed",
        context: { mediaId: playlistMedia.body.media.id },
        appVersion: "1.0.1",
        osVersion: "Android 14",
        networkStatus: "wifi"
      });

    assert.equal(logged.status, 201);
    assert.equal(logged.body.deviceLog.severity, "error");
    assert.equal(logged.body.deviceLog.deviceName, "Event Screen");

    const playback = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKEVENT001",
        secret: "event-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "idle"
      });

    assert.equal(playback.status, 200);
    assert.equal(playback.body.playback.queue.length, 4);
    assert.deepEqual(
      playback.body.playback.queue.map((entry) => entry.sourceType),
      ["playlist", "event", "playlist", "event"]
    );
    assert.equal(playback.body.playback.queue[1].eventId, playbackEvent.body.playbackEvent.id);

    const bootstrap = await request(isolatedApp).get("/api/bootstrap").set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(bootstrap.body.playbackEvents.length, 1);
    assert.equal(bootstrap.body.deviceLogs.length, 1);
    assert.equal(bootstrap.body.deviceLogs[0].component, "playback");
    assert.equal(bootstrap.body.deviceLogs[0].clientName, "Events Client");

    await rm(isolatedDataDir, { recursive: true, force: true });
  });
});

function uploadTestMedia(
  app: Awaited<ReturnType<typeof createApp>>,
  token: string,
  media: {
    clientId: string;
    title: string;
    kind: "video" | "image" | "audio";
    fileName: string;
    mimeType: string;
    durationSeconds: number;
  }
) {
  return request(app)
    .post("/api/media")
    .set("Authorization", `Bearer ${token}`)
    .field("clientId", media.clientId)
    .field("title", media.title)
    .field("kind", media.kind)
    .field("durationSeconds", String(media.durationSeconds))
    .field("hasAudio", String(media.kind !== "image"))
    .field("status", "published")
    .field("tags", "")
    .attach("file", Buffer.from(`${media.title} fixture`), {
      filename: media.fileName,
      contentType: media.mimeType
    });
}

function createFakePrisma(calls: string[]) {
  const tables: Record<string, any[]> = {
    user: [],
    client: [],
    channel: [],
    media: [],
    playlist: [],
    playlistItem: [],
    schedule: [],
    device: [],
    deviceCommand: [],
    playbackEvent: [],
    deviceLog: []
  };

  const model = (name: string) => ({
    async findMany() {
      calls.push(`${name}.findMany`);
      return tables[name];
    },
    async deleteMany() {
      calls.push(`${name}.deleteMany`);
      tables[name] = [];
    },
    async createMany({ data }: { data: any[] }) {
      calls.push(`${name}.createMany`);
      tables[name].push(...data);
    }
  });

  return {
    user: model("user"),
    client: model("client"),
    userClient: model("userClient"),
    channel: model("channel"),
    media: model("media"),
    playlist: model("playlist"),
    playlistItem: model("playlistItem"),
    schedule: model("schedule"),
    device: model("device"),
    deviceCommand: model("deviceCommand"),
    playbackEvent: model("playbackEvent"),
    deviceLog: model("deviceLog"),
    session: model("session"),
    auditLog: model("auditLog"),
    async $transaction(callback: (tx: unknown) => Promise<void>) {
      calls.push("$transaction");
      await callback(this);
    }
  };
}
