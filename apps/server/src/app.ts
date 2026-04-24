import express from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canManageUsers } from "./security/rbac.js";
import { createPrismaClient, loadPrismaDatabase, persistPrismaDatabase } from "./storage/prismaDatabase.js";

declare global {
  namespace Express {
    interface Request {
      token?: string;
      user?: any;
    }
  }
}

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const packageDir = resolve(currentDir, "..");
const defaultRootDir = resolve(packageDir, "../..");

export type ServerConfig = {
  port?: number;
  rootDir?: string;
  dataDir?: string;
  databaseUrl?: string;
  env?: Record<string, string | undefined>;
  prismaClient?: any;
  publicBaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
};

let rootDir = defaultRootDir;
let dataDir = resolve(process.env.DATA_DIR || join(rootDir, "data"));
let uploadsDir = join(dataDir, "uploads");
let databasePath = join(dataDir, "app-db.json");
let cmsDistDir = join(rootDir, "apps/cms/dist");
let cmsPublicDir = join(rootDir, "apps/cms/public");

let port = Number(process.env.PORT || 3000);
let publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
let adminEmail = (process.env.ADMIN_EMAIL || "admin@berry-secure.pl").trim().toLowerCase();
let adminPassword = (process.env.ADMIN_PASSWORD || "berry-secure-admin").trim();
let adminName = (process.env.ADMIN_NAME || "Berry Secure Admin").trim();
let storageMode: "json" | "prisma" = "json";
let databaseUrl = "";
let prismaClient: any = null;

let sessions = new Map<string, string>();
let database: any = null;
let persistQueue = Promise.resolve();

export function resolveServerConfig(config: ServerConfig = {}) {
  const env = config.env || process.env;
  const nextRootDir = resolve(config.rootDir || defaultRootDir);
  const nextDataDir = resolve(config.dataDir || env.DATA_DIR || join(nextRootDir, "data"));
  const databaseUrl = String(config.databaseUrl || env.DATABASE_URL || "").trim();

  return {
    port: Number(config.port || env.PORT || 3000),
    rootDir: nextRootDir,
    dataDir: nextDataDir,
    databaseUrl,
    storageMode: databaseUrl ? "prisma" : "json",
    publicBaseUrl: String(config.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? "")
      .trim()
      .replace(/\/$/, ""),
    adminEmail: String(config.adminEmail || env.ADMIN_EMAIL || "admin@berry-secure.pl")
      .trim()
      .toLowerCase(),
    adminPassword: String(config.adminPassword || env.ADMIN_PASSWORD || "berry-secure-admin").trim(),
    adminName: String(config.adminName || env.ADMIN_NAME || "Berry Secure Admin").trim()
  };
}

export async function createApp(config: ServerConfig = {}) {
  const resolvedConfig = resolveServerConfig(config);
  rootDir = resolvedConfig.rootDir;
  dataDir = resolvedConfig.dataDir;
  uploadsDir = join(dataDir, "uploads");
  databasePath = join(dataDir, "app-db.json");
  cmsDistDir = join(rootDir, "apps/cms/dist");
  cmsPublicDir = join(rootDir, "apps/cms/public");
  port = resolvedConfig.port;
  publicBaseUrl = resolvedConfig.publicBaseUrl;
  adminEmail = resolvedConfig.adminEmail;
  adminPassword = resolvedConfig.adminPassword;
  adminName = resolvedConfig.adminName;
  storageMode = resolvedConfig.storageMode as "json" | "prisma";
  databaseUrl = resolvedConfig.databaseUrl;
  prismaClient = config.prismaClient || (databaseUrl ? createPrismaClient(databaseUrl) : null);
  sessions = new Map();
  persistQueue = Promise.resolve();

  await ensureDirectories();
  database = await loadDatabase();
  await ensureAdminAccount();

  const upload = multer({
    storage: multer.diskStorage({
      destination(_req, _file, callback) {
        callback(null, uploadsDir);
      },
      filename(_req, file, callback) {
        const extension = extname(file.originalname || "").toLowerCase();
        callback(null, `${Date.now()}-${randomBytes(6).toString("hex")}${extension}`);
      }
    })
  });

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "digital-signage-server",
    time: nowIso()
  });
});

app.get("/api/installation", (_req, res) => {
  res.json({
    apiBaseUrl: publicBaseUrl || "",
    apkUrl: "/app/maasck.apk"
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const user = database.users.find((entry) => entry.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ message: "Nieprawidłowy email lub hasło." });
    return;
  }

  const token = randomBytes(24).toString("hex");
  sessions.set(token, user.id);
  res.json({
    token,
    user: sanitizeUser(user)
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: sanitizeUser(req.user)
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  res.json(buildBootstrapPayload(req));
});

app.post("/api/users", requireAuth, async (req, res) => {
  if (!requireUserManagementPermission(req, res)) {
    return;
  }

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  const role = String(req.body?.role || "editor").trim() || "editor";

  if (!email || !password || password.length < 8 || !name) {
    res.status(400).json({ message: "Użytkownik wymaga imienia, emaila i hasła min. 8 znaków." });
    return;
  }

  if (database.users.some((entry) => entry.email === email)) {
    res.status(409).json({ message: "Użytkownik z tym emailem już istnieje." });
    return;
  }

  const user = {
    id: randomUUID(),
    email,
    name,
    role: ["owner", "manager", "editor"].includes(role) ? role : "editor",
    passwordHash: hashPassword(password),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.users.unshift(user);
  await persistDatabase();
  res.status(201).json({ user: sanitizeUser(user) });
});

app.put("/api/users/:id", requireAuth, async (req, res) => {
  if (!requireUserManagementPermission(req, res)) {
    return;
  }

  const user = findById(database.users, req.params.id);
  if (!user) {
    res.status(404).json({ message: "Nie znaleziono użytkownika." });
    return;
  }

  const email = String(req.body?.email || user.email)
    .trim()
    .toLowerCase();
  if (database.users.some((entry) => entry.id !== user.id && entry.email === email)) {
    res.status(409).json({ message: "Inny użytkownik ma już ten email." });
    return;
  }

  user.email = email || user.email;
  user.name = String(req.body?.name || user.name).trim() || user.name;
  const nextRole = String(req.body?.role || user.role).trim() || user.role;
  user.role = ["owner", "manager", "editor"].includes(nextRole) ? nextRole : user.role;
  const nextPassword = String(req.body?.password || "");
  if (nextPassword) {
    if (nextPassword.length < 8) {
      res.status(400).json({ message: "Nowe hasło musi mieć co najmniej 8 znaków." });
      return;
    }
    user.passwordHash = hashPassword(nextPassword);
  }
  touch(user);
  await persistDatabase();
  res.json({ user: sanitizeUser(user) });
});

app.delete("/api/users/:id", requireAuth, async (req, res) => {
  if (!requireUserManagementPermission(req, res)) {
    return;
  }

  if (req.params.id === req.user.id) {
    res.status(400).json({ message: "Nie możesz usunąć aktualnie zalogowanego użytkownika." });
    return;
  }

  const user = findById(database.users, req.params.id);
  if (!user) {
    res.status(404).json({ message: "Nie znaleziono użytkownika." });
    return;
  }

  database.users = database.users.filter((entry) => entry.id !== user.id);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/clients", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ message: "Nazwa klienta jest wymagana." });
    return;
  }

  const client = {
    id: randomUUID(),
    name,
    slug: uniqueSlug(name, database.clients.map((entry) => entry.slug)),
    brandColor: String(req.body?.brandColor || "#ff6a3c").trim() || "#ff6a3c",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.clients.unshift(client);
  await persistDatabase();
  res.status(201).json({ client });
});

app.put("/api/clients/:id", requireAuth, async (req, res) => {
  const client = findById(database.clients, req.params.id);
  if (!client) {
    res.status(404).json({ message: "Nie znaleziono klienta." });
    return;
  }

  client.name = String(req.body?.name || client.name).trim() || client.name;
  client.slug = uniqueSlug(
    String(req.body?.slug || client.slug).trim() || client.name,
    database.clients.filter((entry) => entry.id !== client.id).map((entry) => entry.slug)
  );
  client.brandColor = String(req.body?.brandColor || client.brandColor).trim() || client.brandColor;
  touch(client);
  await persistDatabase();
  res.json({ client });
});

app.delete("/api/clients/:id", requireAuth, async (req, res) => {
  const clientId = req.params.id;
  const client = findById(database.clients, clientId);
  if (!client) {
    res.status(404).json({ message: "Nie znaleziono klienta." });
    return;
  }

  const channelIds = database.channels.filter((entry) => entry.clientId === clientId).map((entry) => entry.id);
  const playlistIds = database.playlists.filter((entry) => entry.clientId === clientId).map((entry) => entry.id);
  const mediaToDelete = database.media.filter((entry) => entry.clientId === clientId);

  database.clients = database.clients.filter((entry) => entry.id !== clientId);
  database.channels = database.channels.filter((entry) => entry.clientId !== clientId);
  database.playlists = database.playlists.filter((entry) => entry.clientId !== clientId);
  database.playlistItems = database.playlistItems.filter((entry) => !playlistIds.includes(entry.playlistId));
  database.schedules = database.schedules.filter((entry) => entry.clientId !== clientId);
  database.devices = database.devices.map((entry) =>
    entry.clientId === clientId
      ? {
          ...entry,
          approvalStatus: "pending",
          clientId: "",
          channelId: "",
          locationLabel: "",
          desiredDisplayState: "active",
          notes: ""
        }
      : entry
  );
  database.media = database.media.filter((entry) => entry.clientId !== clientId);

  await Promise.all(mediaToDelete.map((entry) => removeUploadFile(entry.fileName)));
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/channels", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const clientId = String(req.body?.clientId || "").trim();
  if (!name || !clientId) {
    res.status(400).json({ message: "Kanał wymaga nazwy i klienta." });
    return;
  }

  if (!findById(database.clients, clientId)) {
    res.status(400).json({ message: "Wybrany klient nie istnieje." });
    return;
  }

  const channel = {
    id: randomUUID(),
    clientId,
    name,
    slug: uniqueSlug(name, database.channels.map((entry) => entry.slug)),
    description: String(req.body?.description || "").trim(),
    orientation: req.body?.orientation === "portrait" ? "portrait" : "landscape",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.channels.unshift(channel);
  await persistDatabase();
  res.status(201).json({ channel });
});

app.put("/api/channels/:id", requireAuth, async (req, res) => {
  const channel = findById(database.channels, req.params.id);
  if (!channel) {
    res.status(404).json({ message: "Nie znaleziono kanału." });
    return;
  }

  const nextClientId = String(req.body?.clientId || channel.clientId).trim();
  if (!findById(database.clients, nextClientId)) {
    res.status(400).json({ message: "Wybrany klient nie istnieje." });
    return;
  }

  channel.clientId = nextClientId;
  channel.name = String(req.body?.name || channel.name).trim() || channel.name;
  channel.slug = uniqueSlug(
    String(req.body?.slug || channel.slug).trim() || channel.name,
    database.channels.filter((entry) => entry.id !== channel.id).map((entry) => entry.slug)
  );
  channel.description = String(req.body?.description || channel.description).trim();
  channel.orientation = req.body?.orientation === "portrait" ? "portrait" : "landscape";
  touch(channel);
  await persistDatabase();
  res.json({ channel });
});

app.delete("/api/channels/:id", requireAuth, async (req, res) => {
  const channelId = req.params.id;
  database.channels = database.channels.filter((entry) => entry.id !== channelId);
  database.playlists = database.playlists.map((entry) =>
    entry.channelId === channelId ? { ...entry, channelId: "", updatedAt: nowIso() } : entry
  );
  database.schedules = database.schedules.filter((entry) => entry.channelId !== channelId);
  database.devices = database.devices.map((entry) =>
    entry.channelId === channelId
      ? {
          ...entry,
          approvalStatus: "pending",
          channelId: "",
          desiredDisplayState: "active",
          updatedAt: nowIso()
        }
      : entry
  );
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/media", requireAuth, upload.single("file"), async (req, res) => {
  const clientId = String(req.body?.clientId || "").trim();
  if (!req.file || !clientId || !findById(database.clients, clientId)) {
    if (req.file) {
      await removeUploadFile(req.file.filename);
    }
    res.status(400).json({ message: "Media wymagają pliku i poprawnego klienta." });
    return;
  }

  const media = {
    id: randomUUID(),
    clientId,
    title: String(req.body?.title || req.file.originalname || "Nowe media").trim(),
    kind: req.body?.kind === "image" ? "image" : "video",
    fileName: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    durationSeconds: Number(req.body?.durationSeconds || 10) || 10,
    hasAudio: String(req.body?.hasAudio || "").toLowerCase() === "true",
    status: req.body?.status === "draft" ? "draft" : "published",
    tags: String(req.body?.tags || "").trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.media.unshift(media);
  await persistDatabase();
  res.status(201).json({ media: enrichMedia(media, getRequestBaseUrl(req)) });
});

app.delete("/api/media/:id", requireAuth, async (req, res) => {
  const media = findById(database.media, req.params.id);
  if (!media) {
    res.status(404).json({ message: "Nie znaleziono pliku media." });
    return;
  }

  database.media = database.media.filter((entry) => entry.id !== media.id);
  database.playlistItems = database.playlistItems.filter((entry) => entry.mediaId !== media.id);
  await removeUploadFile(media.fileName);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/playlists", requireAuth, async (req, res) => {
  const clientId = String(req.body?.clientId || "").trim();
  const name = String(req.body?.name || "").trim();
  if (!clientId || !name) {
    res.status(400).json({ message: "Playlista wymaga klienta i nazwy." });
    return;
  }

  const playlist = {
    id: randomUUID(),
    clientId,
    channelId: String(req.body?.channelId || "").trim(),
    name,
    isActive: req.body?.isActive !== false,
    notes: String(req.body?.notes || "").trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.playlists.unshift(playlist);
  await persistDatabase();
  res.status(201).json({ playlist });
});

app.put("/api/playlists/:id", requireAuth, async (req, res) => {
  const playlist = findById(database.playlists, req.params.id);
  if (!playlist) {
    res.status(404).json({ message: "Nie znaleziono playlisty." });
    return;
  }

  playlist.clientId = String(req.body?.clientId || playlist.clientId).trim() || playlist.clientId;
  playlist.channelId = String(req.body?.channelId || playlist.channelId).trim();
  playlist.name = String(req.body?.name || playlist.name).trim() || playlist.name;
  playlist.isActive = req.body?.isActive !== false;
  playlist.notes = String(req.body?.notes || playlist.notes).trim();
  touch(playlist);
  await persistDatabase();
  res.json({ playlist });
});

app.delete("/api/playlists/:id", requireAuth, async (req, res) => {
  const playlistId = req.params.id;
  database.playlists = database.playlists.filter((entry) => entry.id !== playlistId);
  database.playlistItems = database.playlistItems.filter((entry) => entry.playlistId !== playlistId);
  database.schedules = database.schedules.filter((entry) => entry.playlistId !== playlistId);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/playlists/:id/items", requireAuth, async (req, res) => {
  const playlist = findById(database.playlists, req.params.id);
  if (!playlist) {
    res.status(404).json({ message: "Nie znaleziono playlisty." });
    return;
  }

  const mediaId = String(req.body?.mediaId || "").trim();
  if (!findById(database.media, mediaId)) {
    res.status(400).json({ message: "Wybierz istniejące media." });
    return;
  }

  const existingItems = database.playlistItems.filter((entry) => entry.playlistId === playlist.id);
  const playlistItem = {
    id: randomUUID(),
    playlistId: playlist.id,
    mediaId,
    sortOrder: Number(req.body?.sortOrder || existingItems.length * 10 + 10) || existingItems.length * 10 + 10,
    loopCount: Number(req.body?.loopCount || 1) || 1,
    volumePercent: Number(req.body?.volumePercent || 100) || 100,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.playlistItems.push(playlistItem);
  await persistDatabase();
  res.status(201).json({ playlistItem });
});

app.put("/api/playlists/:playlistId/items/:itemId", requireAuth, async (req, res) => {
  const item = findById(database.playlistItems, req.params.itemId);
  if (!item || item.playlistId !== req.params.playlistId) {
    res.status(404).json({ message: "Nie znaleziono elementu playlisty." });
    return;
  }

  item.mediaId = String(req.body?.mediaId || item.mediaId).trim() || item.mediaId;
  item.sortOrder = Number(req.body?.sortOrder || item.sortOrder) || item.sortOrder;
  item.loopCount = Number(req.body?.loopCount || item.loopCount) || item.loopCount;
  item.volumePercent = Number(req.body?.volumePercent || item.volumePercent) || item.volumePercent;
  touch(item);
  await persistDatabase();
  res.json({ playlistItem: item });
});

app.delete("/api/playlists/:playlistId/items/:itemId", requireAuth, async (req, res) => {
  database.playlistItems = database.playlistItems.filter((entry) => entry.id !== req.params.itemId);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/schedules", requireAuth, async (req, res) => {
  const schedule = buildScheduleRecord(req.body);
  if (!schedule.clientId || !schedule.channelId || !schedule.playlistId || !schedule.label) {
    res.status(400).json({ message: "Harmonogram wymaga klienta, kanału, playlisty i etykiety." });
    return;
  }

  database.schedules.unshift(schedule);
  await persistDatabase();
  res.status(201).json({ schedule });
});

app.put("/api/schedules/:id", requireAuth, async (req, res) => {
  const schedule = findById(database.schedules, req.params.id);
  if (!schedule) {
    res.status(404).json({ message: "Nie znaleziono harmonogramu." });
    return;
  }

  Object.assign(schedule, buildScheduleRecord(req.body, schedule));
  touch(schedule);
  await persistDatabase();
  res.json({ schedule });
});

app.delete("/api/schedules/:id", requireAuth, async (req, res) => {
  database.schedules = database.schedules.filter((entry) => entry.id !== req.params.id);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/devices/approve", requireAuth, async (req, res) => {
  const device = findDevice(req.body?.deviceId, req.body?.serial);
  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia do zatwierdzenia." });
    return;
  }

  const clientId = String(req.body?.clientId || "").trim();
  const channelId = String(req.body?.channelId || "").trim();
  if (!findById(database.clients, clientId) || !findById(database.channels, channelId)) {
    res.status(400).json({ message: "Wybierz poprawnego klienta i kanał." });
    return;
  }

  device.approvalStatus = "approved";
  device.name = String(req.body?.name || device.name || `Ekran ${device.serial}`).trim() || `Ekran ${device.serial}`;
  device.clientId = clientId;
  device.channelId = channelId;
  device.locationLabel = String(req.body?.locationLabel || device.locationLabel || device.name).trim();
  device.notes = String(req.body?.notes || device.notes || "").trim();
  device.desiredDisplayState = req.body?.desiredDisplayState === "blackout" ? "blackout" : "active";
  device.volumePercent = clampNumber(Number(req.body?.volumePercent || device.volumePercent || 80), 0, 100);
  touch(device);
  await persistDatabase();
  res.json({ device: presentDevice(device) });
});

app.put("/api/devices/:id", requireAuth, async (req, res) => {
  const device = findById(database.devices, req.params.id);
  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia." });
    return;
  }

  device.name = String(req.body?.name || device.name).trim() || device.name;
  device.clientId = String(req.body?.clientId || device.clientId).trim();
  device.channelId = String(req.body?.channelId || device.channelId).trim();
  device.locationLabel = String(req.body?.locationLabel || device.locationLabel).trim();
  device.notes = String(req.body?.notes || device.notes).trim();
  device.desiredDisplayState = req.body?.desiredDisplayState === "blackout" ? "blackout" : "active";
  device.volumePercent = clampNumber(Number(req.body?.volumePercent || device.volumePercent || 80), 0, 100);
  if (req.body?.approvalStatus === "pending" || req.body?.approvalStatus === "approved") {
    device.approvalStatus = req.body.approvalStatus;
  }
  touch(device);
  await persistDatabase();
  res.json({ device: presentDevice(device) });
});

app.post("/api/devices/:id/reset", requireAuth, async (req, res) => {
  const device = findById(database.devices, req.params.id);
  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia." });
    return;
  }

  device.approvalStatus = "pending";
  device.clientId = "";
  device.channelId = "";
  device.locationLabel = "";
  device.desiredDisplayState = "active";
  touch(device);
  await persistDatabase();
  res.json({ device: presentDevice(device) });
});

app.delete("/api/devices/:id", requireAuth, async (req, res) => {
  database.devices = database.devices.filter((entry) => entry.id !== req.params.id);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/player/session", async (req, res) => {
  const serial = normalizeSerial(String(req.body?.serial || ""));
  const secret = String(req.body?.secret || "").trim();
  if (!serial || !secret) {
    res.status(400).json({ message: "Urządzenie musi wysłać numer seryjny i klucz lokalny." });
    return;
  }

  let device = database.devices.find((entry) => entry.serial === serial);
  if (!device) {
    device = {
      id: randomUUID(),
      serial,
      secret,
      approvalStatus: "pending",
      name: "Android TV",
      clientId: "",
      channelId: "",
      locationLabel: "",
      notes: "",
      platform: String(req.body?.platform || "android").trim() || "android",
      appVersion: String(req.body?.appVersion || "").trim(),
      deviceModel: String(req.body?.deviceModel || "Android TV").trim() || "Android TV",
      desiredDisplayState: "active",
      volumePercent: 80,
      playerState: "waiting",
      playerMessage: "Urządzenie czeka na zatwierdzenie w CMS.",
      activeItemTitle: "",
      lastSeenAt: nowIso(),
      lastSyncAt: "",
      lastPlaybackAt: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    database.devices.unshift(device);
    await persistDatabase();
  } else if (device.secret !== secret) {
    res.status(409).json({
      message: "Numer seryjny jest już przypisany do innej instalacji. Zresetuj urządzenie w CMS."
    });
    return;
  }

  device.platform = String(req.body?.platform || device.platform || "android").trim() || "android";
  device.appVersion = String(req.body?.appVersion || device.appVersion || "").trim();
  device.deviceModel = String(req.body?.deviceModel || device.deviceModel || "Android TV").trim() || "Android TV";
  device.playerState = String(req.body?.playerState || device.playerState || "waiting").trim() || "waiting";
  device.playerMessage = String(req.body?.playerMessage || device.playerMessage || "").trim();
  device.activeItemTitle = String(req.body?.activeItemTitle || "").trim();
  device.lastSeenAt = nowIso();
  if (device.playerState === "playing") {
    device.lastPlaybackAt = nowIso();
  }
  touch(device);

  const playback = device.approvalStatus === "approved" ? buildPlaybackPayload(device, req) : emptyPlayback();
  if (device.approvalStatus === "approved") {
    device.lastSyncAt = nowIso();
  }
  await persistDatabase();

  res.json({
    device: presentDevice(device),
    approvalStatus: device.approvalStatus,
    playback,
    serverTime: nowIso()
  });
});

app.post("/api/player/reset", async (req, res) => {
  const serial = normalizeSerial(String(req.body?.serial || ""));
  const secret = String(req.body?.secret || "").trim();
  const device = database.devices.find((entry) => entry.serial === serial && entry.secret === secret);

  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia do resetu." });
    return;
  }

  device.approvalStatus = "pending";
  device.clientId = "";
  device.channelId = "";
  device.locationLabel = "";
  device.desiredDisplayState = "active";
  device.playerState = "waiting";
  device.playerMessage = "Urządzenie zostało rozłączone i czeka na ponowne zatwierdzenie.";
  device.activeItemTitle = "";
  touch(device);
  await persistDatabase();
  res.json({
    ok: true,
    device: presentDevice(device)
  });
});

app.use("/uploads", express.static(uploadsDir, { fallthrough: true }));
app.use("/app", express.static(join(cmsPublicDir, "app"), { fallthrough: true }));
app.use(express.static(cmsDistDir, { fallthrough: true }));

app.use(async (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }

  try {
    const html = await fs.readFile(join(cmsDistDir, "index.html"), "utf8");
    res.type("html").send(html);
  } catch {
    res
      .status(503)
      .send("CMS build not found. Run `npm run build:cms` before starting the server.");
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    message: "Serwer napotkał błąd i nie mógł obsłużyć żądania."
  });
});

  return app;
}

function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = sessions.get(token);
  const user = userId ? database.users.find((entry) => entry.id === userId) : null;

  if (!token || !user) {
    res.status(401).json({ message: "Sesja wygasła lub nie jesteś zalogowany." });
    return;
  }

  req.token = token;
  req.user = user;
  next();
}

function requireUserManagementPermission(req, res) {
  if (
    canManageUsers({
      role: req.user?.role || "editor",
      clientIds: req.user?.clientIds || []
    })
  ) {
    return true;
  }

  res.status(403).json({ message: "Brak uprawnień do zarządzania użytkownikami." });
  return false;
}

function buildBootstrapPayload(req) {
  const baseUrl = getRequestBaseUrl(req);
  return {
    user: sanitizeUser(req.user),
    users: [...database.users].sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || ""), "pl", {
        sensitivity: "base",
        numeric: true
      })
    ).map(sanitizeUser),
    installation: {
      apiBaseUrl: baseUrl,
      apkUrl: `${baseUrl}/app/maasck.apk`
    },
    clients: [...database.clients].sort(sortByName),
    channels: [...database.channels].sort(sortByName),
    media: [...database.media].sort(sortByUpdatedDesc).map((entry) => enrichMedia(entry, baseUrl)),
    playlists: buildPlaylistViews(),
    schedules: [...database.schedules].sort(sortByPriorityDesc),
    devices: [...database.devices].sort(sortDevices).map((entry) => presentDevice(entry))
  };
}

function buildPlaybackPayload(device, req) {
  const baseUrl = getRequestBaseUrl(req);
  const channelPlaylists = database.playlists
    .filter(
      (entry) =>
        entry.clientId === device.clientId &&
        entry.isActive &&
        (!entry.channelId || entry.channelId === device.channelId)
    )
    .sort(sortByName);

  const activeSchedule =
    database.schedules
      .filter((entry) => entry.clientId === device.clientId && entry.channelId === device.channelId && entry.isActive)
      .filter(matchesScheduleNow)
      .sort(sortByPriorityDesc)[0] || null;

  const resolvedPlaylist =
    (activeSchedule ? findById(database.playlists, activeSchedule.playlistId) : null) || channelPlaylists[0] || null;

  if (!resolvedPlaylist) {
    return {
      mode: "idle",
      queue: [],
      label: "",
      reason: "Brak aktywnej playlisty dla tego kanału.",
      fallbackUsed: false
    };
  }

  const queue = buildPlaylistQueue(resolvedPlaylist.id, baseUrl);
  if (!queue.length) {
    return {
      mode: "idle",
      queue: [],
      label: resolvedPlaylist.name,
      reason: "Playlista nie zawiera jeszcze opublikowanych materiałów.",
      fallbackUsed: !activeSchedule
    };
  }

  return {
    mode: "playlist",
    queue,
    label: activeSchedule?.label || resolvedPlaylist.name,
    reason: activeSchedule
      ? `Aktywny harmonogram: ${activeSchedule.label}`
      : `Fallback do pierwszej aktywnej playlisty kanału: ${resolvedPlaylist.name}`,
    fallbackUsed: !activeSchedule
  };
}

function emptyPlayback() {
  return {
    mode: "idle",
    queue: [],
    label: "",
    reason: "Urządzenie czeka na zatwierdzenie w CMS.",
    fallbackUsed: false
  };
}

function buildPlaylistQueue(playlistId, baseUrl) {
  return database.playlistItems
    .filter((entry) => entry.playlistId === playlistId)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((entry) => {
      const media = findById(database.media, entry.mediaId);
      if (!media || media.status !== "published") {
        return [];
      }

      const repeats = Math.max(Number(entry.loopCount || 1), 1);
      const url = `${baseUrl}/uploads/${media.fileName}`;
      return Array.from({ length: repeats }, (_, index) => ({
        id: `${entry.id}:${index}`,
        playlistId,
        title: media.title,
        kind: media.kind,
        url,
        durationSeconds: Number(media.durationSeconds || 10) || 10,
        volumePercent: clampNumber(Number(entry.volumePercent || 100), 0, 100),
        hasAudio: Boolean(media.hasAudio)
      }));
    });
}

function buildPlaylistViews() {
  return [...database.playlists]
    .sort(sortByName)
    .map((playlist) => ({
      ...playlist,
      items: database.playlistItems
        .filter((entry) => entry.playlistId === playlist.id)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((entry) => ({
          ...entry,
          media: findById(database.media, entry.mediaId) || null
        }))
    }));
}

function presentDevice(device) {
  const client = device.clientId ? findById(database.clients, device.clientId) : null;
  const channel = device.channelId ? findById(database.channels, device.channelId) : null;
  const lastSeenValue = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
  const isOnline = lastSeenValue > 0 && Date.now() - lastSeenValue < 90_000;

  return {
    ...device,
    clientName: client?.name || "",
    channelName: channel?.name || "",
    online: isOnline
  };
}

function enrichMedia(media, baseUrl) {
  return {
    ...media,
    url: `${baseUrl}/uploads/${media.fileName}`
  };
}

function findDevice(deviceId, serial) {
  if (deviceId) {
    return findById(database.devices, String(deviceId));
  }

  if (serial) {
    return database.devices.find((entry) => entry.serial === normalizeSerial(String(serial))) || null;
  }

  return null;
}

function buildScheduleRecord(body, current = null) {
  return {
    id: current?.id || randomUUID(),
    clientId: String(body?.clientId || current?.clientId || "").trim(),
    channelId: String(body?.channelId || current?.channelId || "").trim(),
    playlistId: String(body?.playlistId || current?.playlistId || "").trim(),
    label: String(body?.label || current?.label || "").trim(),
    startDate: String(body?.startDate || current?.startDate || "").trim(),
    endDate: String(body?.endDate || current?.endDate || "").trim(),
    startTime: String(body?.startTime || current?.startTime || "00:00").trim() || "00:00",
    endTime: String(body?.endTime || current?.endTime || "23:59").trim() || "23:59",
    daysOfWeek: String(body?.daysOfWeek || current?.daysOfWeek || "0,1,2,3,4,5,6").trim() || "0,1,2,3,4,5,6",
    priority: Number(body?.priority || current?.priority || 100) || 100,
    isActive: body?.isActive !== false,
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function matchesScheduleNow(schedule) {
  const now = new Date();
  const nowTime = now.getHours() * 60 + now.getMinutes();

  if (schedule.startDate) {
    const startDate = new Date(schedule.startDate).setHours(0, 0, 0, 0);
    if (now.getTime() < startDate) {
      return false;
    }
  }

  if (schedule.endDate) {
    const endDate = new Date(schedule.endDate).setHours(23, 59, 59, 999);
    if (now.getTime() > endDate) {
      return false;
    }
  }

  const allowedDays = schedule.daysOfWeek
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => !Number.isNaN(value));
  if (allowedDays.length && !allowedDays.includes(now.getDay())) {
    return false;
  }

  const startTime = clockToMinutes(schedule.startTime || "00:00");
  const endTime = clockToMinutes(schedule.endTime || "23:59");
  if (startTime <= endTime) {
    return nowTime >= startTime && nowTime <= endTime;
  }

  return nowTime >= startTime || nowTime <= endTime;
}

function clockToMinutes(value) {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map((entry) => Number(entry));
  return (hours || 0) * 60 + (minutes || 0);
}

function sortByName(left, right) {
  return String(left.name || "").localeCompare(String(right.name || ""), "pl", {
    sensitivity: "base",
    numeric: true
  });
}

function sortByUpdatedDesc(left, right) {
  return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
}

function sortByPriorityDesc(left, right) {
  return Number(right.priority || 0) - Number(left.priority || 0);
}

function sortDevices(left, right) {
  const pendingWeight = left.approvalStatus === "pending" ? -1 : 1;
  const comparePending =
    (left.approvalStatus === "pending" ? -1 : 1) - (right.approvalStatus === "pending" ? -1 : 1);
  if (comparePending !== 0) {
    return comparePending;
  }

  return new Date(right.lastSeenAt || 0).getTime() - new Date(left.lastSeenAt || 0).getTime() || pendingWeight;
}

function uniqueSlug(value, taken) {
  const base = slugify(value) || "item";
  let slug = base;
  let counter = 2;
  const used = new Set(taken);
  while (used.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSerial(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

async function ensureAdminAccount() {
  if (!database.users.length) {
    database.users.push({
      id: randomUUID(),
      email: adminEmail,
      name: adminName,
      role: "owner",
      passwordHash: hashPassword(adminPassword),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    await persistDatabase();
    return;
  }

  const existing = database.users.find((entry) => entry.email === adminEmail);
  if (!existing) {
    database.users.push({
      id: randomUUID(),
      email: adminEmail,
      name: adminName,
      role: "owner",
      passwordHash: hashPassword(adminPassword),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    await persistDatabase();
  }
}

async function loadDatabase() {
  if (storageMode === "prisma") {
    if (!prismaClient) {
      throw new Error("DATABASE_URL is configured but Prisma client could not be initialized.");
    }

    return loadPrismaDatabase(prismaClient);
  }

  try {
    const raw = await fs.readFile(databasePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      media: Array.isArray(parsed.media) ? parsed.media : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      playlistItems: Array.isArray(parsed.playlistItems) ? parsed.playlistItems : [],
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : []
    };
  } catch {
    const initial = {
      users: [],
      clients: [],
      channels: [],
      media: [],
      playlists: [],
      playlistItems: [],
      schedules: [],
      devices: []
    };
    await fs.writeFile(databasePath, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function persistDatabase() {
  if (storageMode === "prisma") {
    if (!prismaClient) {
      throw new Error("DATABASE_URL is configured but Prisma client could not be initialized.");
    }

    persistQueue = persistQueue.then(() => persistPrismaDatabase(prismaClient, database));
    await persistQueue;
    return;
  }

  persistQueue = persistQueue.then(() =>
    fs.writeFile(databasePath, JSON.stringify(database, null, 2), "utf8")
  );
  await persistQueue;
}

async function ensureDirectories() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function removeUploadFile(fileName) {
  if (!fileName) {
    return;
  }

  try {
    await fs.unlink(join(uploadsDir, fileName));
  } catch {
    // ignore
  }
}

function getRequestBaseUrl(req) {
  if (publicBaseUrl) {
    return publicBaseUrl;
  }
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`).split(",")[0];
  return `${proto}://${host}`;
}

function nowIso() {
  return new Date().toISOString();
}

function findById(collection, id) {
  return collection.find((entry) => entry.id === id) || null;
}

function touch(record) {
  record.updatedAt = nowIso();
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
