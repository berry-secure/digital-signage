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
        playerType: "video_premium",
        desiredDisplayState: "active",
        volumePercent: 70
      });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.device.playerType, "video_premium");

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
});

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
    deviceCommand: []
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
    session: model("session"),
    auditLog: model("auditLog"),
    async $transaction(callback: (tx: unknown) => Promise<void>) {
      calls.push("$transaction");
      await callback(this);
    }
  };
}
