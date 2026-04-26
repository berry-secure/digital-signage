import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

  it("records proof of play with media version metadata and exposes it to CMS reports", async () => {
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-proof-"));
    const isolatedApp = await createApp({
      dataDir: isolatedDataDir,
      adminEmail: "proof-owner@example.test",
      adminPassword: "strong-password",
      adminName: "Proof Owner",
      publicBaseUrl: "https://cms.example.test"
    });

    const ownerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "proof-owner@example.test", password: "strong-password" });
    const ownerToken = ownerLogin.body.token;

    const client = await request(isolatedApp)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Proof Client" });
    const channel = await request(isolatedApp)
      .post("/api/channels")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: client.body.client.id, name: "Main Channel" });
    const media = await uploadTestMedia(isolatedApp, ownerToken, {
      clientId: client.body.client.id,
      title: "Proof Clip",
      kind: "video",
      fileName: "proof.mp4",
      mimeType: "video/mp4",
      durationSeconds: 45
    });
    const expectedChecksum = createHash("sha256").update("Proof Clip fixture").digest("hex");

    assert.equal(media.body.media.checksum, expectedChecksum);
    assert.equal(media.body.media.contentVersion, 1);

    const playlist = await request(isolatedApp)
      .post("/api/playlists")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        name: "Proof Playlist",
        isActive: true,
        notes: ""
      });

    await request(isolatedApp)
      .post(`/api/playlists/${playlist.body.playlist.id}/items`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        mediaId: media.body.media.id,
        sortOrder: 10,
        loopCount: 1,
        volumePercent: 80
      });

    const playerSession = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKPROOF001",
        secret: "proof-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting"
      });

    await request(isolatedApp)
      .post("/api/devices/approve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        deviceId: playerSession.body.device.id,
        serial: "MKPROOF001",
        name: "Proof Screen",
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        locationLabel: "Lobby",
        notes: "",
        playerType: "video_standard",
        desiredDisplayState: "active",
        volumePercent: 80
      });

    const playback = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKPROOF001",
        secret: "proof-secret",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "idle"
      });

    const queueEntry = playback.body.playback.queue[0];
    assert.equal(queueEntry.mediaId, media.body.media.id);
    assert.equal(queueEntry.checksum, expectedChecksum);
    assert.equal(queueEntry.contentVersion, 1);

    const started = await request(isolatedApp)
      .post("/api/player/proof-of-play")
      .send({
        serial: "MKPROOF001",
        secret: "proof-secret",
        status: "started",
        playlistId: queueEntry.playlistId,
        scheduleId: queueEntry.scheduleId,
        mediaId: queueEntry.mediaId,
        playbackItemId: queueEntry.id,
        sourceType: queueEntry.sourceType,
        mediaTitle: queueEntry.title,
        mediaKind: queueEntry.kind,
        startedAt: "2026-04-25T00:00:00.000Z",
        durationSeconds: queueEntry.durationSeconds,
        checksum: queueEntry.checksum,
        contentVersion: queueEntry.contentVersion,
        appVersion: "1.0.1"
      });

    assert.equal(started.status, 201);
    assert.equal(started.body.proofOfPlay.status, "started");
    assert.equal(started.body.proofOfPlay.deviceName, "Proof Screen");
    assert.equal(started.body.proofOfPlay.clientName, "Proof Client");
    assert.equal(started.body.proofOfPlay.channelName, "Main Channel");
    assert.equal(started.body.proofOfPlay.checksum, expectedChecksum);

    const finished = await request(isolatedApp)
      .post("/api/player/proof-of-play")
      .send({
        serial: "MKPROOF001",
        secret: "proof-secret",
        status: "finished",
        playlistId: queueEntry.playlistId,
        scheduleId: queueEntry.scheduleId,
        mediaId: queueEntry.mediaId,
        playbackItemId: queueEntry.id,
        sourceType: queueEntry.sourceType,
        mediaTitle: queueEntry.title,
        mediaKind: queueEntry.kind,
        finishedAt: "2026-04-25T00:00:45.000Z",
        durationSeconds: queueEntry.durationSeconds,
        checksum: queueEntry.checksum,
        contentVersion: queueEntry.contentVersion,
        appVersion: "1.0.1"
      });

    assert.equal(finished.status, 201);
    assert.equal(finished.body.proofOfPlay.status, "finished");

    const bootstrap = await request(isolatedApp).get("/api/bootstrap").set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(bootstrap.body.proofOfPlay.length, 2);
    assert.deepEqual(
      bootstrap.body.proofOfPlay.map((entry) => entry.status).sort(),
      ["finished", "started"]
    );

    await rm(isolatedDataDir, { recursive: true, force: true });
  });

  it("targets channels, playlist items, devices, and user access by client locations", async () => {
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-locations-"));
    const isolatedApp = await createApp({
      dataDir: isolatedDataDir,
      adminEmail: "locations-owner@example.test",
      adminPassword: "strong-password",
      adminName: "Locations Owner",
      publicBaseUrl: "https://cms.example.test"
    });

    const ownerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "locations-owner@example.test", password: "strong-password" });
    const ownerToken = ownerLogin.body.token;

    const client = await request(isolatedApp)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Multi Site Client" });
    const locationA = await request(isolatedApp)
      .post("/api/locations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: client.body.client.id, name: "Warszawa Centrum", city: "Warszawa" });
    const locationB = await request(isolatedApp)
      .post("/api/locations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: client.body.client.id, name: "Kraków Galeria", city: "Kraków" });

    assert.equal(locationA.status, 201);
    assert.equal(locationB.status, 201);

    const channel = await request(isolatedApp)
      .post("/api/channels")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: client.body.client.id,
        name: "Menu Board",
        locationIds: [locationA.body.location.id]
      });
    const media = await uploadTestMedia(isolatedApp, ownerToken, {
      clientId: client.body.client.id,
      title: "Local Promo",
      kind: "video",
      fileName: "promo.mp4",
      mimeType: "video/mp4",
      durationSeconds: 20
    });
    const playlist = await request(isolatedApp)
      .post("/api/playlists")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        name: "Menu Playlist",
        isActive: true,
        notes: ""
      });

    await request(isolatedApp)
      .post(`/api/playlists/${playlist.body.playlist.id}/items`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        mediaId: media.body.media.id,
        sortOrder: 10,
        loopCount: 1,
        volumePercent: 80,
        locationIds: [locationA.body.location.id]
      });

    const playerA = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKLOC0001",
        secret: "loc-secret-a",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting"
      });
    const playerB = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKLOC0002",
        secret: "loc-secret-b",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "waiting"
      });

    await request(isolatedApp)
      .post("/api/devices/approve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        deviceId: playerA.body.device.id,
        serial: "MKLOC0001",
        name: "Warszawa Screen",
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        locationId: locationA.body.location.id,
        playerType: "video_standard"
      });
    await request(isolatedApp)
      .post("/api/devices/approve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        deviceId: playerB.body.device.id,
        serial: "MKLOC0002",
        name: "Kraków Screen",
        clientId: client.body.client.id,
        channelId: channel.body.channel.id,
        locationId: locationB.body.location.id,
        playerType: "video_standard"
      });

    const sessionA = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKLOC0001",
        secret: "loc-secret-a",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "idle"
      });
    const sessionB = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: "MKLOC0002",
        secret: "loc-secret-b",
        platform: "android",
        appVersion: "1.0.1",
        deviceModel: "Android TV",
        playerState: "idle"
      });

    assert.equal(sessionA.body.playback.mode, "playlist");
    assert.equal(sessionA.body.playback.queue[0].locationIds[0], locationA.body.location.id);
    assert.equal(sessionB.body.playback.mode, "idle");

    const manager = await request(isolatedApp)
      .post("/api/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "manager.locations@example.test",
        password: "manager-password",
        name: "Location Manager",
        role: "manager",
        clientIds: [client.body.client.id],
        allLocations: false,
        locationIds: [locationA.body.location.id]
      });
    assert.equal(manager.status, 201);
    assert.deepEqual(manager.body.user.clientIds, [client.body.client.id]);
    assert.equal(manager.body.user.locationAccesses[0].allLocations, false);

    const managerLogin = await request(isolatedApp)
      .post("/api/auth/login")
      .send({ email: "manager.locations@example.test", password: "manager-password" });
    const managerBootstrap = await request(isolatedApp)
      .get("/api/bootstrap")
      .set("Authorization", `Bearer ${managerLogin.body.token}`);

    assert.deepEqual(managerBootstrap.body.locations.map((entry) => entry.id), [locationA.body.location.id]);
    assert.deepEqual(managerBootstrap.body.devices.map((entry) => entry.id), [playerA.body.device.id]);
    assert.equal(managerBootstrap.body.devices[0].locationName, "Warszawa Centrum");

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
    userClient: [],
    userLocationAccess: [],
    channel: [],
    channelLocation: [],
    media: [],
    playlist: [],
    playlistItem: [],
    playlistItemLocation: [],
    schedule: [],
    device: [],
    deviceCommand: [],
    playbackEvent: [],
    deviceLog: [],
    proofOfPlay: [],
    location: []
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
    location: model("location"),
    userClient: model("userClient"),
    userLocationAccess: model("userLocationAccess"),
    channel: model("channel"),
    channelLocation: model("channelLocation"),
    media: model("media"),
    playlist: model("playlist"),
    playlistItem: model("playlistItem"),
    playlistItemLocation: model("playlistItemLocation"),
    schedule: model("schedule"),
    device: model("device"),
    deviceCommand: model("deviceCommand"),
    playbackEvent: model("playbackEvent"),
    deviceLog: model("deviceLog"),
    proofOfPlay: model("proofOfPlay"),
    session: model("session"),
    auditLog: model("auditLog"),
    async $transaction(callback: (tx: unknown) => Promise<void>) {
      calls.push("$transaction");
      await callback(this);
    }
  };
}
