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

const devicePlayerTypes = new Set([
  "music_mini",
  "music_max",
  "video_standard",
  "video_premium",
  "streaming",
  "android_tv",
  "mobile_app"
]);
const deviceCommandTypes = new Set([
  "reboot_os",
  "restart_app",
  "force_sync",
  "force_playlist_update",
  "force_app_update",
  "clear_cache",
  "screenshot",
  "blackout",
  "wake",
  "set_volume",
  "network_diagnostics",
  "upload_logs",
  "rotate_secret"
]);
const deviceCommandStatuses = new Set(["pending", "sent", "acked", "failed"]);
const mediaKinds = new Set(["video", "image", "audio"]);
const playbackEventTypes = new Set(["audio", "visual"]);
const playbackEventTriggerModes = new Set(["items", "minutes"]);
const deviceLogSeverities = new Set(["info", "warn", "error"]);
const proofOfPlayStatuses = new Set(["started", "finished", "error"]);
const playbackSourceTypes = new Set(["playlist", "event"]);

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
  syncUserAccess(user.id, req.body);
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
  syncUserAccess(user.id, req.body);
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
  database.userClients = database.userClients.filter((entry) => entry.userId !== user.id);
  database.userLocationAccesses = database.userLocationAccesses.filter((entry) => entry.userId !== user.id);
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
  const locationIds = database.locations.filter((entry) => entry.clientId === clientId).map((entry) => entry.id);
  const mediaToDelete = database.media.filter((entry) => entry.clientId === clientId);
  const resetDeviceIds = database.devices.filter((entry) => entry.clientId === clientId).map((entry) => entry.id);

  database.clients = database.clients.filter((entry) => entry.id !== clientId);
  database.locations = database.locations.filter((entry) => entry.clientId !== clientId);
  database.userClients = database.userClients.filter((entry) => entry.clientId !== clientId);
  database.userLocationAccesses = database.userLocationAccesses.filter((entry) => entry.clientId !== clientId);
  database.channelLocations = database.channelLocations.filter((entry) => !locationIds.includes(entry.locationId));
  database.channels = database.channels.filter((entry) => entry.clientId !== clientId);
  database.playlists = database.playlists.filter((entry) => entry.clientId !== clientId);
  database.playlistItemLocations = database.playlistItemLocations.filter((entry) => !locationIds.includes(entry.locationId));
  database.playlistItems = database.playlistItems.filter((entry) => !playlistIds.includes(entry.playlistId));
  database.schedules = database.schedules.filter((entry) => entry.clientId !== clientId);
  database.devices = database.devices.map((entry) =>
    entry.clientId === clientId
      ? {
          ...entry,
          approvalStatus: "pending",
          clientId: "",
          channelId: "",
          locationId: "",
          locationLabel: "",
          desiredDisplayState: "active",
          notes: ""
        }
      : entry
  );
  database.media = database.media.filter((entry) => entry.clientId !== clientId);
  database.deviceCommands = database.deviceCommands.filter((entry) => !resetDeviceIds.includes(entry.deviceId));
  database.playbackEvents = database.playbackEvents.filter((entry) => entry.clientId !== clientId);
  database.proofOfPlay = database.proofOfPlay.filter((entry) => !resetDeviceIds.includes(entry.deviceId));

  await Promise.all(mediaToDelete.map((entry) => removeUploadFile(entry.fileName)));
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/locations", requireAuth, async (req, res) => {
  const location = buildLocationRecord(req.body);
  const validationError = validateLocation(location);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  database.locations.unshift(location);
  await persistDatabase();
  res.status(201).json({ location });
});

app.put("/api/locations/:id", requireAuth, async (req, res) => {
  const location = findById(database.locations, req.params.id);
  if (!location) {
    res.status(404).json({ message: "Nie znaleziono lokalizacji." });
    return;
  }

  const nextLocation = buildLocationRecord(req.body, location);
  const validationError = validateLocation(nextLocation);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  Object.assign(location, nextLocation);
  touch(location);
  await persistDatabase();
  res.json({ location });
});

app.delete("/api/locations/:id", requireAuth, async (req, res) => {
  const location = findById(database.locations, req.params.id);
  if (!location) {
    res.status(404).json({ message: "Nie znaleziono lokalizacji." });
    return;
  }

  database.locations = database.locations.filter((entry) => entry.id !== location.id);
  database.channelLocations = database.channelLocations.filter((entry) => entry.locationId !== location.id);
  database.playlistItemLocations = database.playlistItemLocations.filter((entry) => entry.locationId !== location.id);
  database.userLocationAccesses = database.userLocationAccesses.filter((entry) => entry.locationId !== location.id);
  database.devices = database.devices.map((entry) =>
    entry.locationId === location.id
      ? {
          ...entry,
          locationId: "",
          locationLabel: "",
          updatedAt: nowIso()
        }
      : entry
  );
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
  const locationIds = normalizeLocationIds(req.body?.locationIds, clientId);
  if (!locationsBelongToClient(locationIds, clientId)) {
    res.status(400).json({ message: "Lokalizacje kanału muszą należeć do tego klienta." });
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
  syncChannelLocations(channel.id, locationIds);
  await persistDatabase();
  res.status(201).json({ channel: presentChannel(channel) });
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
  const locationIds = normalizeLocationIds(req.body?.locationIds, nextClientId, getChannelLocationIds(channel.id));
  if (!locationsBelongToClient(locationIds, nextClientId)) {
    res.status(400).json({ message: "Lokalizacje kanału muszą należeć do tego klienta." });
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
  syncChannelLocations(channel.id, locationIds);
  touch(channel);
  await persistDatabase();
  res.json({ channel: presentChannel(channel) });
});

app.delete("/api/channels/:id", requireAuth, async (req, res) => {
  const channelId = req.params.id;
  database.channels = database.channels.filter((entry) => entry.id !== channelId);
  database.channelLocations = database.channelLocations.filter((entry) => entry.channelId !== channelId);
  database.playlists = database.playlists.map((entry) =>
    entry.channelId === channelId ? { ...entry, channelId: "", updatedAt: nowIso() } : entry
  );
  database.schedules = database.schedules.filter((entry) => entry.channelId !== channelId);
  database.playbackEvents = database.playbackEvents.map((entry) =>
    entry.channelId === channelId ? { ...entry, channelId: "", updatedAt: nowIso() } : entry
  );
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
    kind: normalizeMediaKind(req.body?.kind),
    fileName: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    durationSeconds: Number(req.body?.durationSeconds || 10) || 10,
    hasAudio: String(req.body?.hasAudio || "").toLowerCase() === "true",
    status: req.body?.status === "draft" ? "draft" : "published",
    tags: String(req.body?.tags || "").trim(),
    checksum: await checksumFile(join(uploadsDir, req.file.filename)),
    contentVersion: 1,
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
  database.playbackEvents = database.playbackEvents.filter((entry) => entry.mediaId !== media.id);
  await removeUploadFile(media.fileName);
  await persistDatabase();
  res.json({ ok: true });
});

app.post("/api/playback-events", requireAuth, async (req, res) => {
  const event = buildPlaybackEventRecord(req.body);
  const validationError = validatePlaybackEvent(event);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  database.playbackEvents.unshift(event);
  await persistDatabase();
  res.status(201).json({ playbackEvent: presentPlaybackEvent(event, getRequestBaseUrl(req)) });
});

app.put("/api/playback-events/:id", requireAuth, async (req, res) => {
  const event = findById(database.playbackEvents, req.params.id);
  if (!event) {
    res.status(404).json({ message: "Nie znaleziono eventu emisji." });
    return;
  }

  const nextEvent = buildPlaybackEventRecord(req.body, event);
  const validationError = validatePlaybackEvent(nextEvent);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  Object.assign(event, nextEvent);
  touch(event);
  await persistDatabase();
  res.json({ playbackEvent: presentPlaybackEvent(event, getRequestBaseUrl(req)) });
});

app.delete("/api/playback-events/:id", requireAuth, async (req, res) => {
  database.playbackEvents = database.playbackEvents.filter((entry) => entry.id !== req.params.id);
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
  const locationIds = normalizeLocationIds(req.body?.locationIds, playlist.clientId);
  if (!locationsBelongToClient(locationIds, playlist.clientId)) {
    res.status(400).json({ message: "Lokalizacje pozycji playlisty muszą należeć do klienta playlisty." });
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
  syncPlaylistItemLocations(playlistItem.id, locationIds);
  await persistDatabase();
  res.status(201).json({ playlistItem: presentPlaylistItem(playlistItem) });
});

app.put("/api/playlists/:playlistId/items/:itemId", requireAuth, async (req, res) => {
  const item = findById(database.playlistItems, req.params.itemId);
  if (!item || item.playlistId !== req.params.playlistId) {
    res.status(404).json({ message: "Nie znaleziono elementu playlisty." });
    return;
  }
  const playlist = findById(database.playlists, item.playlistId);
  const locationIds = normalizeLocationIds(
    req.body?.locationIds,
    playlist?.clientId || "",
    getPlaylistItemLocationIds(item.id)
  );
  if (!playlist || !locationsBelongToClient(locationIds, playlist.clientId)) {
    res.status(400).json({ message: "Lokalizacje pozycji playlisty muszą należeć do klienta playlisty." });
    return;
  }

  item.mediaId = String(req.body?.mediaId || item.mediaId).trim() || item.mediaId;
  item.sortOrder = Number(req.body?.sortOrder || item.sortOrder) || item.sortOrder;
  item.loopCount = Number(req.body?.loopCount || item.loopCount) || item.loopCount;
  item.volumePercent = Number(req.body?.volumePercent || item.volumePercent) || item.volumePercent;
  syncPlaylistItemLocations(item.id, locationIds);
  touch(item);
  await persistDatabase();
  res.json({ playlistItem: presentPlaylistItem(item) });
});

app.delete("/api/playlists/:playlistId/items/:itemId", requireAuth, async (req, res) => {
  database.playlistItems = database.playlistItems.filter((entry) => entry.id !== req.params.itemId);
  database.playlistItemLocations = database.playlistItemLocations.filter((entry) => entry.playlistItemId !== req.params.itemId);
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
  const locationId = String(req.body?.locationId || "").trim();
  const location = locationId ? findById(database.locations, locationId) : null;
  if (locationId && (!location || location.clientId !== clientId)) {
    res.status(400).json({ message: "Lokalizacja urządzenia musi należeć do wybranego klienta." });
    return;
  }

  device.approvalStatus = "approved";
  device.name = String(req.body?.name || device.name || `Ekran ${device.serial}`).trim() || `Ekran ${device.serial}`;
  device.clientId = clientId;
  device.channelId = channelId;
  device.locationId = locationId;
  device.playerType = normalizeDevicePlayerType(req.body?.playerType || device.playerType);
  device.locationLabel = String(req.body?.locationLabel || location?.name || device.locationLabel || device.name).trim();
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
  const locationId = String(req.body?.locationId ?? device.locationId ?? "").trim();
  const location = locationId ? findById(database.locations, locationId) : null;
  if (locationId && (!location || location.clientId !== device.clientId)) {
    res.status(400).json({ message: "Lokalizacja urządzenia musi należeć do wybranego klienta." });
    return;
  }
  device.locationId = locationId;
  device.playerType = normalizeDevicePlayerType(req.body?.playerType || device.playerType);
  device.locationLabel = String(req.body?.locationLabel || location?.name || device.locationLabel).trim();
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

app.post("/api/devices/:id/commands", requireAuth, async (req, res) => {
  const device = findById(database.devices, req.params.id);
  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia." });
    return;
  }

  if (device.approvalStatus !== "approved") {
    res.status(400).json({ message: "Komendy live można wysyłać tylko do zatwierdzonych urządzeń." });
    return;
  }

  const type = normalizeDeviceCommandType(req.body?.type);
  if (!type) {
    res.status(400).json({ message: "Nieznany typ komendy live." });
    return;
  }

  const command = {
    id: randomUUID(),
    deviceId: device.id,
    type,
    status: "pending",
    payload: buildDeviceCommandPayload(type, req.body?.payload),
    message: "",
    requestedByUserId: req.user?.id || "",
    requestedAt: nowIso(),
    sentAt: "",
    ackedAt: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  applyDeviceCommandSideEffects(device, command);
  database.deviceCommands.unshift(command);
  touch(device);
  await persistDatabase();
  res.status(201).json({
    command: presentDeviceCommand(command),
    device: presentDevice(device)
  });
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
  device.locationId = "";
  device.locationLabel = "";
  device.desiredDisplayState = "active";
  database.deviceCommands = database.deviceCommands.filter((entry) => entry.deviceId !== device.id);
  touch(device);
  await persistDatabase();
  res.json({ device: presentDevice(device) });
});

app.delete("/api/devices/:id", requireAuth, async (req, res) => {
  database.devices = database.devices.filter((entry) => entry.id !== req.params.id);
  database.deviceCommands = database.deviceCommands.filter((entry) => entry.deviceId !== req.params.id);
  database.deviceLogs = database.deviceLogs.filter((entry) => entry.deviceId !== req.params.id);
  database.proofOfPlay = database.proofOfPlay.filter((entry) => entry.deviceId !== req.params.id);
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
      locationId: "",
      locationLabel: "",
      notes: "",
      platform: String(req.body?.platform || "android").trim() || "android",
      appVersion: String(req.body?.appVersion || "").trim(),
      deviceModel: String(req.body?.deviceModel || "Android TV").trim() || "Android TV",
      playerType: "video_standard",
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
  device.playerType = normalizeDevicePlayerType(device.playerType);
  device.playerState = String(req.body?.playerState || device.playerState || "waiting").trim() || "waiting";
  device.playerMessage = String(req.body?.playerMessage || device.playerMessage || "").trim();
  device.activeItemTitle = String(req.body?.activeItemTitle || "").trim();
  device.lastSeenAt = nowIso();
  if (device.playerState === "playing") {
    device.lastPlaybackAt = nowIso();
  }
  touch(device);

  const commands = device.approvalStatus === "approved" ? takePendingDeviceCommands(device) : [];
  const playback = device.approvalStatus === "approved" ? buildPlaybackPayload(device, req) : emptyPlayback();
  if (device.approvalStatus === "approved") {
    device.lastSyncAt = nowIso();
  }
  await persistDatabase();

  res.json({
    device: presentDevice(device),
    approvalStatus: device.approvalStatus,
    playback,
    commands: commands.map(presentPlayerCommand),
    serverTime: nowIso()
  });
});

app.post("/api/player/logs", async (req, res) => {
  const serial = normalizeSerial(String(req.body?.serial || ""));
  const secret = String(req.body?.secret || "").trim();
  const device = database.devices.find((entry) => entry.serial === serial && entry.secret === secret);

  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia dla logu playera." });
    return;
  }

  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ message: "Log playera wymaga wiadomości." });
    return;
  }

  const deviceLog = {
    id: randomUUID(),
    deviceId: device.id,
    severity: normalizeDeviceLogSeverity(req.body?.severity),
    component: String(req.body?.component || "player").trim() || "player",
    message,
    stack: String(req.body?.stack || "").trim(),
    context: isPlainObject(req.body?.context) ? req.body.context : {},
    appVersion: String(req.body?.appVersion || device.appVersion || "").trim(),
    osVersion: String(req.body?.osVersion || "").trim(),
    networkStatus: String(req.body?.networkStatus || "").trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.deviceLogs.unshift(deviceLog);
  device.lastSeenAt = nowIso();
  touch(device);
  await persistDatabase();
  res.status(201).json({ deviceLog: presentDeviceLog(deviceLog) });
});

app.post("/api/player/proof-of-play", async (req, res) => {
  const serial = normalizeSerial(String(req.body?.serial || ""));
  const secret = String(req.body?.secret || "").trim();
  const device = database.devices.find((entry) => entry.serial === serial && entry.secret === secret);

  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia dla proof of play." });
    return;
  }

  const status = normalizeProofOfPlayStatus(req.body?.status);
  if (!status) {
    res.status(400).json({ message: "Proof of Play wymaga statusu started, finished albo error." });
    return;
  }

  const mediaId = String(req.body?.mediaId || "").trim();
  const media = mediaId ? findById(database.media, mediaId) : null;
  const occurredAt =
    String(req.body?.occurredAt || "").trim() ||
    (status === "finished"
      ? String(req.body?.finishedAt || "").trim()
      : String(req.body?.startedAt || "").trim()) ||
    nowIso();
  const proofOfPlay = {
    id: randomUUID(),
    deviceId: device.id,
    status,
    sourceType: normalizePlaybackSourceType(req.body?.sourceType),
    playlistId: String(req.body?.playlistId || "").trim(),
    scheduleId: String(req.body?.scheduleId || "").trim(),
    mediaId,
    playbackItemId: String(req.body?.playbackItemId || "").trim(),
    eventId: String(req.body?.eventId || "").trim(),
    mediaTitle: String(req.body?.mediaTitle || media?.title || "").trim(),
    mediaKind: normalizeMediaKind(req.body?.mediaKind || media?.kind || ""),
    startedAt: String(req.body?.startedAt || (status === "started" ? occurredAt : "")).trim(),
    finishedAt: String(req.body?.finishedAt || (status === "finished" ? occurredAt : "")).trim(),
    occurredAt,
    durationSeconds: Math.max(Number(req.body?.durationSeconds || media?.durationSeconds || 0), 0),
    checksum: String(req.body?.checksum || media?.checksum || "").trim(),
    contentVersion: Math.max(Number(req.body?.contentVersion || media?.contentVersion || 1), 1),
    errorMessage: String(req.body?.errorMessage || "").trim(),
    appVersion: String(req.body?.appVersion || device.appVersion || "").trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  database.proofOfPlay.unshift(proofOfPlay);
  database.proofOfPlay = database.proofOfPlay.slice(0, 10_000);
  device.lastSeenAt = nowIso();
  device.lastPlaybackAt = nowIso();
  touch(device);
  await persistDatabase();
  res.status(201).json({ proofOfPlay: presentProofOfPlay(proofOfPlay) });
});

app.post("/api/player/commands/:id/ack", async (req, res) => {
  const serial = normalizeSerial(String(req.body?.serial || ""));
  const secret = String(req.body?.secret || "").trim();
  const command = findById(database.deviceCommands, req.params.id);

  if (!command) {
    res.status(404).json({ message: "Nie znaleziono komendy live." });
    return;
  }

  const device = database.devices.find((entry) => entry.id === command.deviceId && entry.serial === serial && entry.secret === secret);
  if (!device) {
    res.status(404).json({ message: "Nie znaleziono urządzenia dla tej komendy." });
    return;
  }

  const status = req.body?.status === "failed" ? "failed" : "acked";
  command.status = status;
  command.message = String(req.body?.message || (status === "acked" ? "ACK" : "Command failed")).trim();
  command.ackedAt = nowIso();
  touch(command);
  await persistDatabase();

  res.json({ command: presentDeviceCommand(command) });
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
  device.locationId = "";
  device.locationLabel = "";
  device.desiredDisplayState = "active";
  device.playerState = "waiting";
  device.playerMessage = "Urządzenie zostało rozłączone i czeka na ponowne zatwierdzenie.";
  device.activeItemTitle = "";
  database.deviceCommands = database.deviceCommands.filter((entry) => entry.deviceId !== device.id);
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
  const scope = buildUserScope(req.user);
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
      apkUrl: `${baseUrl}/app/maasck.apk`,
      storageMode,
      databaseConfigured: Boolean(databaseUrl),
      dataDir
    },
    clients: [...database.clients].filter((entry) => scope.canSeeClient(entry.id)).sort(sortByName),
    locations: [...database.locations]
      .filter((entry) => scope.canSeeLocation(entry.clientId, entry.id))
      .sort(sortByName),
    channels: [...database.channels]
      .filter((entry) => scope.canSeeClient(entry.clientId) && scope.canSeeTargetedRecord(entry.clientId, getChannelLocationIds(entry.id)))
      .sort(sortByName)
      .map(presentChannel),
    media: [...database.media]
      .filter((entry) => scope.canSeeClient(entry.clientId))
      .sort(sortByUpdatedDesc)
      .map((entry) => enrichMedia(entry, baseUrl)),
    playlists: buildPlaylistViews(scope),
    schedules: [...database.schedules]
      .filter((entry) => scope.canSeeClient(entry.clientId))
      .sort(sortByPriorityDesc),
    devices: [...database.devices]
      .filter((entry) => scope.canSeeDevice(entry))
      .sort(sortDevices)
      .map((entry) => presentDevice(entry)),
    deviceCommands: [...database.deviceCommands]
      .filter((entry) => scope.canSeeDevice(findById(database.devices, entry.deviceId)))
      .sort(sortByUpdatedDesc)
      .slice(0, 250)
      .map((entry) => presentDeviceCommand(entry)),
    playbackEvents: [...database.playbackEvents]
      .filter((entry) => scope.canSeeClient(entry.clientId))
      .sort(sortPlaybackEvents)
      .map((entry) => presentPlaybackEvent(entry, baseUrl)),
    deviceLogs: [...database.deviceLogs]
      .filter((entry) => scope.canSeeDevice(findById(database.devices, entry.deviceId)))
      .sort(sortByCreatedDesc)
      .slice(0, 250)
      .map((entry) => presentDeviceLog(entry)),
    proofOfPlay: [...database.proofOfPlay]
      .filter((entry) => scope.canSeeDevice(findById(database.devices, entry.deviceId)))
      .sort(sortProofOfPlayDesc)
      .slice(0, 1000)
      .map((entry) => presentProofOfPlay(entry))
  };
}

function buildPlaybackPayload(device, req) {
  const baseUrl = getRequestBaseUrl(req);
  const channelPlaylists = database.playlists
    .filter(
      (entry) =>
        entry.clientId === device.clientId &&
        entry.isActive &&
        (!entry.channelId || entry.channelId === device.channelId) &&
        channelTargetsDevice(device.channelId, device.locationId)
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

  const queue = buildPlaylistQueue(resolvedPlaylist.id, baseUrl, activeSchedule?.id || "", device.locationId || "");
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
    queue: buildPlaybackQueueWithEvents(queue, buildActivePlaybackEvents(device, baseUrl)),
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

function buildPlaylistQueue(playlistId, baseUrl, scheduleId = "", locationId = "") {
  return database.playlistItems
    .filter((entry) => entry.playlistId === playlistId)
    .filter((entry) => targetLocationsInclude(getPlaylistItemLocationIds(entry.id), locationId))
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
        scheduleId,
        mediaId: media.id,
        title: media.title,
        kind: media.kind,
        url,
        durationSeconds: Number(media.durationSeconds || 10) || 10,
        volumePercent: clampNumber(Number(entry.volumePercent || 100), 0, 100),
        hasAudio: Boolean(media.hasAudio || media.kind === "audio"),
        checksum: media.checksum || "",
        contentVersion: Number(media.contentVersion || 1) || 1,
        sourceType: "playlist",
        locationIds: getPlaylistItemLocationIds(entry.id)
      }));
    });
}

function buildActivePlaybackEvents(device, baseUrl) {
  return database.playbackEvents
    .filter(
      (entry) =>
        entry.isActive !== false &&
        entry.clientId === device.clientId &&
        (!entry.channelId || entry.channelId === device.channelId)
    )
    .sort(sortPlaybackEvents)
    .flatMap((entry) => {
      const media = findById(database.media, entry.mediaId);
      if (!media || media.status !== "published") {
        return [];
      }

      return [
        {
          ...entry,
          media: {
            id: `media:${media.id}`,
            playlistId: "",
            scheduleId: "",
            mediaId: media.id,
            title: media.title,
            kind: media.kind,
            url: `${baseUrl}/uploads/${media.fileName}`,
            durationSeconds: Number(media.durationSeconds || 10) || 10,
            volumePercent: clampNumber(Number(device.volumePercent || 80), 0, 100),
            hasAudio: Boolean(media.hasAudio || media.kind === "audio"),
            checksum: media.checksum || "",
            contentVersion: Number(media.contentVersion || 1) || 1,
            sourceType: "event"
          }
        }
      ];
    });
}

function buildPlaybackQueueWithEvents(queue, events) {
  if (!events.length) {
    return queue.map((entry) => ({ ...entry, sourceType: entry.sourceType || "playlist" }));
  }

  const result = [];
  const occurrences = new Map();
  const nextMinuteThreshold = new Map();
  let elapsedSeconds = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const baseEntry = { ...queue[index], sourceType: queue[index].sourceType || "playlist" };
    result.push(baseEntry);
    elapsedSeconds += Math.max(Number(baseEntry.durationSeconds || 0), 0);

    for (const event of events) {
      if (!shouldInsertPlaybackEvent(event, index + 1, elapsedSeconds, nextMinuteThreshold)) {
        continue;
      }

      const occurrence = (occurrences.get(event.id) || 0) + 1;
      occurrences.set(event.id, occurrence);
      result.push({
        ...event.media,
        id: `event:${event.id}:${occurrence}`,
        playlistId: baseEntry.playlistId || "",
        scheduleId: baseEntry.scheduleId || "",
        title: event.name || event.media.title,
        sourceType: "event",
        eventId: event.id
      });
    }
  }

  return result;
}

function shouldInsertPlaybackEvent(event, playedItems, elapsedSeconds, nextMinuteThreshold) {
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

function buildPlaylistViews(scope = null) {
  return [...database.playlists]
    .filter((playlist) => !scope || scope.canSeeClient(playlist.clientId))
    .sort(sortByName)
    .map((playlist) => ({
      ...playlist,
      items: database.playlistItems
        .filter((entry) => entry.playlistId === playlist.id)
        .filter((entry) => !scope || scope.canSeeTargetedRecord(playlist.clientId, getPlaylistItemLocationIds(entry.id)))
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(presentPlaylistItem)
    }));
}

function presentPlaylistItem(entry) {
  return {
    ...entry,
    locationIds: getPlaylistItemLocationIds(entry.id),
    media: findById(database.media, entry.mediaId) || null
  };
}

function presentChannel(channel) {
  return {
    ...channel,
    locationIds: getChannelLocationIds(channel.id)
  };
}

function presentDevice(device) {
  const client = device.clientId ? findById(database.clients, device.clientId) : null;
  const channel = device.channelId ? findById(database.channels, device.channelId) : null;
  const location = device.locationId ? findById(database.locations, device.locationId) : null;
  const lastSeenValue = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
  const isOnline = lastSeenValue > 0 && Date.now() - lastSeenValue < 90_000;

  return {
    ...device,
    playerType: normalizeDevicePlayerType(device.playerType),
    locationId: device.locationId || "",
    clientName: client?.name || "",
    channelName: channel?.name || "",
    locationName: location?.name || device.locationLabel || "",
    online: isOnline
  };
}

function presentDeviceCommand(command) {
  const device = findById(database.devices, command.deviceId);
  return {
    ...command,
    status: normalizeDeviceCommandStatus(command.status),
    payload: isPlainObject(command.payload) ? command.payload : {},
    requestedAt: command.requestedAt || command.createdAt || "",
    sentAt: command.sentAt || "",
    ackedAt: command.ackedAt || "",
    deviceName: device?.name || "",
    deviceSerial: device?.serial || ""
  };
}

function presentPlaybackEvent(event, baseUrl) {
  const client = findById(database.clients, event.clientId);
  const channel = event.channelId ? findById(database.channels, event.channelId) : null;
  const media = findById(database.media, event.mediaId);

  return {
    ...event,
    eventType: normalizePlaybackEventType(event.eventType),
    triggerMode: normalizePlaybackEventTriggerMode(event.triggerMode),
    channelId: event.channelId || "",
    media: media ? enrichMedia(media, baseUrl) : null,
    clientName: client?.name || "",
    channelName: channel?.name || "",
    mediaTitle: media?.title || "",
    mediaKind: media?.kind || ""
  };
}

function presentDeviceLog(log) {
  const device = findById(database.devices, log.deviceId);
  const client = device?.clientId ? findById(database.clients, device.clientId) : null;
  const channel = device?.channelId ? findById(database.channels, device.channelId) : null;
  return {
    ...log,
    severity: normalizeDeviceLogSeverity(log.severity),
    stack: log.stack || "",
    context: isPlainObject(log.context) ? log.context : {},
    appVersion: log.appVersion || "",
    osVersion: log.osVersion || "",
    networkStatus: log.networkStatus || "",
    deviceName: device?.name || "",
    deviceSerial: device?.serial || "",
    clientId: device?.clientId || "",
    clientName: client?.name || "",
    channelId: device?.channelId || "",
    channelName: channel?.name || ""
  };
}

function presentProofOfPlay(entry) {
  const device = findById(database.devices, entry.deviceId);
  const client = device?.clientId ? findById(database.clients, device.clientId) : null;
  const channel = device?.channelId ? findById(database.channels, device.channelId) : null;
  const media = entry.mediaId ? findById(database.media, entry.mediaId) : null;

  return {
    ...entry,
    status: normalizeProofOfPlayStatus(entry.status) || "started",
    sourceType: normalizePlaybackSourceType(entry.sourceType),
    playlistId: entry.playlistId || "",
    scheduleId: entry.scheduleId || "",
    mediaId: entry.mediaId || "",
    playbackItemId: entry.playbackItemId || "",
    eventId: entry.eventId || "",
    mediaTitle: entry.mediaTitle || media?.title || "",
    mediaKind: normalizeMediaKind(entry.mediaKind || media?.kind || ""),
    startedAt: entry.startedAt || "",
    finishedAt: entry.finishedAt || "",
    occurredAt: entry.occurredAt || entry.createdAt || "",
    durationSeconds: Number(entry.durationSeconds || 0) || 0,
    checksum: entry.checksum || media?.checksum || "",
    contentVersion: Number(entry.contentVersion || media?.contentVersion || 1) || 1,
    errorMessage: entry.errorMessage || "",
    appVersion: entry.appVersion || device?.appVersion || "",
    deviceName: device?.name || "",
    deviceSerial: device?.serial || "",
    clientId: device?.clientId || "",
    clientName: client?.name || "",
    channelId: device?.channelId || "",
    channelName: channel?.name || ""
  };
}

function presentPlayerCommand(command) {
  return {
    id: command.id,
    type: command.type,
    payload: isPlainObject(command.payload) ? command.payload : {},
    requestedAt: command.requestedAt || command.createdAt || ""
  };
}

function enrichMedia(media, baseUrl) {
  return {
    ...media,
    checksum: media.checksum || "",
    contentVersion: Number(media.contentVersion || 1) || 1,
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

function buildLocationRecord(body, current = null) {
  return {
    id: current?.id || randomUUID(),
    clientId: String(body?.clientId || current?.clientId || "").trim(),
    name: String(body?.name || current?.name || "").trim(),
    city: String(body?.city ?? current?.city ?? "").trim(),
    address: String(body?.address ?? current?.address ?? "").trim(),
    notes: String(body?.notes ?? current?.notes ?? "").trim(),
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function validateLocation(location) {
  if (!location.clientId || !findById(database.clients, location.clientId)) {
    return "Lokalizacja wymaga poprawnego klienta.";
  }

  if (!location.name) {
    return "Lokalizacja wymaga nazwy.";
  }

  return "";
}

function normalizeLocationIds(value, clientId, fallback = []) {
  if (value === undefined) {
    return [...fallback];
  }

  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    })
    .filter((entry) => {
      const location = findById(database.locations, entry);
      return Boolean(location && (!clientId || location.clientId === clientId));
    });
}

function locationsBelongToClient(locationIds, clientId) {
  return locationIds.every((locationId) => {
    const location = findById(database.locations, locationId);
    return Boolean(location && location.clientId === clientId);
  });
}

function syncChannelLocations(channelId, locationIds) {
  database.channelLocations = database.channelLocations.filter((entry) => entry.channelId !== channelId);
  database.channelLocations.push(
    ...locationIds.map((locationId) => ({
      id: randomUUID(),
      channelId,
      locationId,
      createdAt: nowIso()
    }))
  );
}

function syncPlaylistItemLocations(playlistItemId, locationIds) {
  database.playlistItemLocations = database.playlistItemLocations.filter((entry) => entry.playlistItemId !== playlistItemId);
  database.playlistItemLocations.push(
    ...locationIds.map((locationId) => ({
      id: randomUUID(),
      playlistItemId,
      locationId,
      createdAt: nowIso()
    }))
  );
}

function getChannelLocationIds(channelId) {
  return database.channelLocations
    .filter((entry) => entry.channelId === channelId)
    .map((entry) => entry.locationId);
}

function getPlaylistItemLocationIds(playlistItemId) {
  return database.playlistItemLocations
    .filter((entry) => entry.playlistItemId === playlistItemId)
    .map((entry) => entry.locationId);
}

function targetLocationsInclude(targetLocationIds, locationId) {
  return !targetLocationIds.length || Boolean(locationId && targetLocationIds.includes(locationId));
}

function channelTargetsDevice(channelId, locationId) {
  if (!channelId) {
    return true;
  }

  return targetLocationsInclude(getChannelLocationIds(channelId), locationId || "");
}

function syncUserAccess(userId, body) {
  const user = findById(database.users, userId);
  if (!user || user.role === "owner") {
    database.userClients = database.userClients.filter((entry) => entry.userId !== userId);
    database.userLocationAccesses = database.userLocationAccesses.filter((entry) => entry.userId !== userId);
    return;
  }

  const clientIds = normalizeClientIds(body?.clientIds);
  const allLocations = body?.allLocations !== false;
  database.userClients = database.userClients.filter((entry) => entry.userId !== userId);
  database.userLocationAccesses = database.userLocationAccesses.filter((entry) => entry.userId !== userId);
  database.userClients.push(
    ...clientIds.map((clientId) => ({
      id: randomUUID(),
      userId,
      clientId,
      allLocations,
      createdAt: nowIso()
    }))
  );

  if (allLocations) {
    return;
  }

  const locationIds = normalizeLocationIds(body?.locationIds, "", []);
  database.userLocationAccesses.push(
    ...locationIds
      .map((locationId) => findById(database.locations, locationId))
      .filter((location) => location && clientIds.includes(location.clientId))
      .map((location) => ({
        id: randomUUID(),
        userId,
        clientId: location.clientId,
        locationId: location.id,
        createdAt: nowIso()
      }))
  );
}

function normalizeClientIds(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    })
    .filter((entry) => Boolean(findById(database.clients, entry)));
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

function buildPlaybackEventRecord(body, current = null) {
  const triggerMode = normalizePlaybackEventTriggerMode(body?.triggerMode || current?.triggerMode);
  return {
    id: current?.id || randomUUID(),
    clientId: String(body?.clientId || current?.clientId || "").trim(),
    channelId: String(body?.channelId ?? current?.channelId ?? "").trim(),
    mediaId: String(body?.mediaId || current?.mediaId || "").trim(),
    name: String(body?.name || current?.name || "").trim(),
    eventType: normalizePlaybackEventType(body?.eventType || current?.eventType),
    triggerMode,
    intervalItems:
      triggerMode === "items"
        ? clampNumber(Number(body?.intervalItems ?? current?.intervalItems ?? 1), 1, 10_000)
        : clampNumber(Number(body?.intervalItems ?? current?.intervalItems ?? 0), 0, 10_000),
    intervalMinutes:
      triggerMode === "minutes"
        ? clampNumber(Number(body?.intervalMinutes ?? current?.intervalMinutes ?? 1), 1, 10_000)
        : clampNumber(Number(body?.intervalMinutes ?? current?.intervalMinutes ?? 0), 0, 10_000),
    priority: clampNumber(Number(body?.priority ?? current?.priority ?? 100), 0, 10_000),
    isActive: body?.isActive ?? current?.isActive ?? true,
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function validatePlaybackEvent(event) {
  const client = findById(database.clients, event.clientId);
  if (!client) {
    return "Event wymaga poprawnego klienta.";
  }

  const media = findById(database.media, event.mediaId);
  if (!media || media.clientId !== event.clientId || media.status !== "published") {
    return "Event wymaga opublikowanego media tego samego klienta.";
  }

  if (event.channelId) {
    const channel = findById(database.channels, event.channelId);
    if (!channel || channel.clientId !== event.clientId) {
      return "Kanał eventu musi należeć do tego samego klienta.";
    }
  }

  if (!event.name) {
    return "Event wymaga nazwy.";
  }

  return "";
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

function sortByCreatedDesc(left, right) {
  return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
}

function sortProofOfPlayDesc(left, right) {
  return (
    new Date(right.occurredAt || right.createdAt || 0).getTime() -
      new Date(left.occurredAt || left.createdAt || 0).getTime() ||
    new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
  );
}

function sortByPriorityDesc(left, right) {
  return Number(right.priority || 0) - Number(left.priority || 0);
}

function sortPlaybackEvents(left, right) {
  return (
    Number(left.priority || 100) - Number(right.priority || 100) ||
    String(left.name || "").localeCompare(String(right.name || ""), "pl", {
      sensitivity: "base",
      numeric: true
    })
  );
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

function normalizeDevicePlayerType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return devicePlayerTypes.has(normalized) ? normalized : "video_standard";
}

function normalizeDeviceCommandType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return deviceCommandTypes.has(normalized) ? normalized : "";
}

function normalizeDeviceCommandStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return deviceCommandStatuses.has(normalized) ? normalized : "pending";
}

function normalizeMediaKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return mediaKinds.has(normalized) ? normalized : "video";
}

function normalizePlaybackEventType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return playbackEventTypes.has(normalized) ? normalized : "visual";
}

function normalizePlaybackEventTriggerMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return playbackEventTriggerModes.has(normalized) ? normalized : "items";
}

function normalizeDeviceLogSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return deviceLogSeverities.has(normalized) ? normalized : "info";
}

function normalizeProofOfPlayStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return proofOfPlayStatuses.has(normalized) ? normalized : "";
}

function normalizePlaybackSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return playbackSourceTypes.has(normalized) ? normalized : "playlist";
}

function buildDeviceCommandPayload(type, payload) {
  const source = isPlainObject(payload) ? payload : {};
  if (type === "set_volume") {
    return {
      volumePercent: clampNumber(Number(source.volumePercent || 80), 0, 100)
    };
  }
  return source;
}

function applyDeviceCommandSideEffects(device, command) {
  if (command.type === "blackout") {
    device.desiredDisplayState = "blackout";
  }
  if (command.type === "wake") {
    device.desiredDisplayState = "active";
  }
  if (command.type === "set_volume") {
    device.volumePercent = clampNumber(Number(command.payload?.volumePercent || device.volumePercent || 80), 0, 100);
  }
}

function takePendingDeviceCommands(device) {
  const sentAt = nowIso();
  return database.deviceCommands
    .filter((entry) => entry.deviceId === device.id && normalizeDeviceCommandStatus(entry.status) === "pending")
    .map((entry) => {
      entry.status = "sent";
      entry.sentAt = sentAt;
      touch(entry);
      return entry;
    });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildUserScope(user) {
  const isOwner = user?.role === "owner";
  const clientAccess = database.userClients.filter((entry) => entry.userId === user?.id);
  const clientIds = new Set(clientAccess.map((entry) => entry.clientId));
  const allLocationClientIds = new Set(clientAccess.filter((entry) => entry.allLocations !== false).map((entry) => entry.clientId));
  const allowedLocationIds = new Set(
    database.userLocationAccesses
      .filter((entry) => entry.userId === user?.id)
      .map((entry) => entry.locationId)
  );

  const canSeeClient = (clientId) => isOwner || clientIds.has(clientId);
  const canSeeLocation = (clientId, locationId) =>
    isOwner || (clientIds.has(clientId) && (allLocationClientIds.has(clientId) || allowedLocationIds.has(locationId)));

  return {
    isOwner,
    canSeeClient,
    canSeeLocation,
    canSeeTargetedRecord(clientId, locationIds) {
      if (isOwner) {
        return true;
      }
      if (!clientIds.has(clientId)) {
        return false;
      }
      if (allLocationClientIds.has(clientId)) {
        return true;
      }
      return locationIds.length === 0 || locationIds.some((locationId) => allowedLocationIds.has(locationId));
    },
    canSeeDevice(device) {
      if (!device) {
        return false;
      }
      if (isOwner) {
        return true;
      }
      if (!device.clientId || !clientIds.has(device.clientId)) {
        return false;
      }
      if (allLocationClientIds.has(device.clientId)) {
        return true;
      }
      return Boolean(device.locationId && allowedLocationIds.has(device.locationId));
    }
  };
}

function sanitizeUser(user) {
  const userClients = database?.userClients?.filter((entry) => entry.userId === user.id) || [];
  const locationAccesses = userClients.map((entry) => ({
    clientId: entry.clientId,
    allLocations: entry.allLocations !== false,
    locationIds:
      entry.allLocations === false
        ? (database?.userLocationAccesses || [])
            .filter((access) => access.userId === user.id && access.clientId === entry.clientId)
            .map((access) => access.locationId)
        : []
  }));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientIds: userClients.map((entry) => entry.clientId),
    locationAccesses
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
      locations: Array.isArray(parsed.locations) ? parsed.locations : [],
      userClients: Array.isArray(parsed.userClients) ? parsed.userClients : [],
      userLocationAccesses: Array.isArray(parsed.userLocationAccesses) ? parsed.userLocationAccesses : [],
      channelLocations: Array.isArray(parsed.channelLocations) ? parsed.channelLocations : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      media: Array.isArray(parsed.media) ? parsed.media : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      playlistItems: Array.isArray(parsed.playlistItems) ? parsed.playlistItems : [],
      playlistItemLocations: Array.isArray(parsed.playlistItemLocations) ? parsed.playlistItemLocations : [],
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      deviceCommands: Array.isArray(parsed.deviceCommands) ? parsed.deviceCommands : [],
      playbackEvents: Array.isArray(parsed.playbackEvents) ? parsed.playbackEvents : [],
      deviceLogs: Array.isArray(parsed.deviceLogs) ? parsed.deviceLogs : [],
      proofOfPlay: Array.isArray(parsed.proofOfPlay) ? parsed.proofOfPlay : []
    };
  } catch {
    const initial = {
      users: [],
      clients: [],
      locations: [],
      userClients: [],
      userLocationAccesses: [],
      channelLocations: [],
      channels: [],
      media: [],
      playlists: [],
      playlistItems: [],
      playlistItemLocations: [],
      schedules: [],
      devices: [],
      deviceCommands: [],
      playbackEvents: [],
      deviceLogs: [],
      proofOfPlay: []
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

async function checksumFile(path) {
  const file = await fs.readFile(path);
  return createHash("sha256").update(file).digest("hex");
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
