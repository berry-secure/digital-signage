import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

type DatabaseShape = {
  users: any[];
  clients: any[];
  channels: any[];
  media: any[];
  playlists: any[];
  playlistItems: any[];
  schedules: any[];
  devices: any[];
  deviceCommands: any[];
};

type AdminOptions = {
  email: string;
  name: string;
  password: string;
  hashPassword: (password: string) => string;
};

export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export function createEmptyDatabase(): DatabaseShape {
  return {
    users: [],
    clients: [],
    channels: [],
    media: [],
    playlists: [],
    playlistItems: [],
    schedules: [],
    devices: [],
    deviceCommands: []
  };
}

export async function ensurePrismaAdminAccount(prisma: any, options: AdminOptions) {
  const email = options.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email }
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email,
      name: options.name.trim() || "Signal Deck Owner",
      role: "owner",
      passwordHash: options.hashPassword(options.password)
    }
  });
}

export async function loadPrismaDatabase(prisma: any): Promise<DatabaseShape> {
  const [users, clients, channels, media, playlists, playlistItems, schedules, devices, deviceCommands] = await Promise.all([
    prisma.user.findMany(),
    prisma.client.findMany(),
    prisma.channel.findMany(),
    prisma.media.findMany(),
    prisma.playlist.findMany(),
    prisma.playlistItem.findMany(),
    prisma.schedule.findMany(),
    prisma.device.findMany(),
    prisma.deviceCommand.findMany()
  ]);

  return {
    users: users.map((entry) => ({
      ...entry,
      role: String(entry.role),
      createdAt: toIso(entry.createdAt),
      updatedAt: toIso(entry.updatedAt)
    })),
    clients: clients.map(withIsoDates),
    channels: channels.map(withIsoDates),
    media: media.map((entry) => ({
      ...withIsoDates(entry),
      kind: String(entry.kind),
      status: String(entry.status)
    })),
    playlists: playlists.map((entry) => ({
      ...withIsoDates(entry),
      channelId: entry.channelId || ""
    })),
    playlistItems: playlistItems.map(withIsoDates),
    schedules: schedules.map(withIsoDates),
    devices: devices.map((entry) => ({
      ...withIsoDates(entry),
      clientId: entry.clientId || "",
      channelId: entry.channelId || "",
      approvalStatus: String(entry.approvalStatus),
      playerType: entry.playerType || "video_standard",
      desiredDisplayState: String(entry.desiredDisplayState),
      playerState: String(entry.playerState),
      lastSeenAt: toIsoOrEmpty(entry.lastSeenAt),
      lastSyncAt: toIsoOrEmpty(entry.lastSyncAt),
      lastPlaybackAt: toIsoOrEmpty(entry.lastPlaybackAt)
    })),
    deviceCommands: deviceCommands.map((entry) => ({
      ...withIsoDates(entry),
      status: String(entry.status || "pending"),
      payload: entry.payload || {},
      requestedByUserId: entry.requestedByUserId || "",
      requestedAt: toIso(entry.requestedAt),
      sentAt: toIsoOrEmpty(entry.sentAt),
      ackedAt: toIsoOrEmpty(entry.ackedAt)
    }))
  };
}

export async function persistPrismaDatabase(prisma: any, database: DatabaseShape) {
  const batches = buildPrismaCreateBatches(database);

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany();
    await tx.session.deleteMany();
    await tx.deviceCommand.deleteMany();
    await tx.userClient.deleteMany();
    await tx.playlistItem.deleteMany();
    await tx.schedule.deleteMany();
    await tx.device.deleteMany();
    await tx.playlist.deleteMany();
    await tx.media.deleteMany();
    await tx.channel.deleteMany();
    await tx.client.deleteMany();
    await tx.user.deleteMany();

    await createMany(tx.user, batches.users);
    await createMany(tx.client, batches.clients);
    await createMany(tx.userClient, batches.userClients);
    await createMany(tx.channel, batches.channels);
    await createMany(tx.media, batches.media);
    await createMany(tx.playlist, batches.playlists);
    await createMany(tx.playlistItem, batches.playlistItems);
    await createMany(tx.schedule, batches.schedules);
    await createMany(tx.device, batches.devices);
    await createMany(tx.deviceCommand, batches.deviceCommands);
  });
}

export function buildPrismaCreateBatches(database: DatabaseShape) {
  const users = database.users.map((entry) => ({
    id: entry.id,
    email: entry.email,
    name: entry.name,
    role: roleOrDefault(entry.role),
    passwordHash: entry.passwordHash,
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt)
  }));

  const clients = database.clients.map((entry) => ({
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    brandColor: entry.brandColor || "#ff6a3c",
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt)
  }));

  const userIds = new Set(users.map((entry) => entry.id));
  const clientIds = new Set(clients.map((entry) => entry.id));

  const userClients = (database as any).userClients
    ? (database as any).userClients
        .filter((entry) => userIds.has(entry.userId) && clientIds.has(entry.clientId))
        .map((entry) => ({
          id: entry.id,
          userId: entry.userId,
          clientId: entry.clientId,
          createdAt: toDate(entry.createdAt)
        }))
    : [];

  const channels = database.channels
    .filter((entry) => clientIds.has(entry.clientId))
    .map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      name: entry.name,
      slug: entry.slug,
      description: entry.description || "",
      orientation: entry.orientation === "portrait" ? "portrait" : "landscape",
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));
  const channelIds = new Set(channels.map((entry) => entry.id));

  const media = database.media
    .filter((entry) => clientIds.has(entry.clientId))
    .map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      title: entry.title,
      kind: entry.kind === "image" ? "image" : "video",
      fileName: entry.fileName,
      originalName: entry.originalName || entry.fileName,
      mimeType: entry.mimeType || "application/octet-stream",
      durationSeconds: Number(entry.durationSeconds || 10) || 10,
      hasAudio: Boolean(entry.hasAudio),
      status: entry.status === "draft" ? "draft" : "published",
      tags: entry.tags || "",
      checksum: entry.checksum || "",
      contentVersion: Number(entry.contentVersion || 1) || 1,
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));
  const mediaIds = new Set(media.map((entry) => entry.id));

  const playlists = database.playlists
    .filter((entry) => clientIds.has(entry.clientId))
    .map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      channelId: channelIds.has(entry.channelId) ? entry.channelId : null,
      name: entry.name,
      isActive: entry.isActive !== false,
      notes: entry.notes || "",
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));
  const playlistIds = new Set(playlists.map((entry) => entry.id));

  const playlistItems = database.playlistItems
    .filter((entry) => playlistIds.has(entry.playlistId) && mediaIds.has(entry.mediaId))
    .map((entry) => ({
      id: entry.id,
      playlistId: entry.playlistId,
      mediaId: entry.mediaId,
      sortOrder: Number(entry.sortOrder || 10) || 10,
      loopCount: Number(entry.loopCount || 1) || 1,
      volumePercent: Number(entry.volumePercent || 100) || 100,
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));

  const schedules = database.schedules
    .filter(
      (entry) => clientIds.has(entry.clientId) && channelIds.has(entry.channelId) && playlistIds.has(entry.playlistId)
    )
    .map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      channelId: entry.channelId,
      playlistId: entry.playlistId,
      label: entry.label,
      startDate: entry.startDate || "",
      endDate: entry.endDate || "",
      startTime: entry.startTime || "00:00",
      endTime: entry.endTime || "23:59",
      daysOfWeek: entry.daysOfWeek || "0,1,2,3,4,5,6",
      priority: Number(entry.priority || 100) || 100,
      isActive: entry.isActive !== false,
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));

  const devices = database.devices.map((entry) => ({
    id: entry.id,
    serial: entry.serial,
    secret: entry.secret,
    approvalStatus: entry.approvalStatus === "approved" ? "approved" : "pending",
    name: entry.name || "Android TV",
    clientId: clientIds.has(entry.clientId) ? entry.clientId : null,
    channelId: channelIds.has(entry.channelId) ? entry.channelId : null,
    locationLabel: entry.locationLabel || "",
    notes: entry.notes || "",
    platform: entry.platform || "android",
    appVersion: entry.appVersion || "",
    deviceModel: entry.deviceModel || "Android TV",
    playerType: playerTypeOrDefault(entry.playerType),
    desiredDisplayState: entry.desiredDisplayState === "blackout" ? "blackout" : "active",
    volumePercent: Number(entry.volumePercent || 80) || 80,
    playerState: ["waiting", "idle", "playing"].includes(entry.playerState) ? entry.playerState : "waiting",
    playerMessage: entry.playerMessage || "",
    activeItemTitle: entry.activeItemTitle || "",
    lastSeenAt: toNullableDate(entry.lastSeenAt),
    lastSyncAt: toNullableDate(entry.lastSyncAt),
    lastPlaybackAt: toNullableDate(entry.lastPlaybackAt),
    createdAt: toDate(entry.createdAt),
    updatedAt: toDate(entry.updatedAt)
  }));
  const deviceIds = new Set(devices.map((entry) => entry.id));
  const userIdsForCommands = new Set(users.map((entry) => entry.id));
  const deviceCommands = ((database as any).deviceCommands || [])
    .filter((entry) => deviceIds.has(entry.deviceId))
    .map((entry) => ({
      id: entry.id,
      deviceId: entry.deviceId,
      type: commandTypeOrDefault(entry.type),
      status: commandStatusOrDefault(entry.status),
      payload: entry.payload || {},
      message: entry.message || "",
      requestedByUserId: userIdsForCommands.has(entry.requestedByUserId) ? entry.requestedByUserId : null,
      requestedAt: toDate(entry.requestedAt || entry.createdAt),
      sentAt: toNullableDate(entry.sentAt),
      ackedAt: toNullableDate(entry.ackedAt),
      createdAt: toDate(entry.createdAt),
      updatedAt: toDate(entry.updatedAt)
    }));

  return {
    users,
    clients,
    userClients,
    channels,
    media,
    playlists,
    playlistItems,
    schedules,
    devices,
    deviceCommands
  };
}

async function createMany(model: any, data: any[]) {
  if (!data.length) {
    return;
  }

  await model.createMany({ data });
}

function withIsoDates(entry: any) {
  return {
    ...entry,
    createdAt: toIso(entry.createdAt),
    updatedAt: toIso(entry.updatedAt)
  };
}

function roleOrDefault(value: string) {
  return ["owner", "manager", "editor"].includes(value) ? value : "editor";
}

function playerTypeOrDefault(value: string) {
  return ["music_mini", "music_max", "video_standard", "video_premium", "streaming", "android_tv", "mobile_app"].includes(
    value
  )
    ? value
    : "video_standard";
}

function commandTypeOrDefault(value: string) {
  return [
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
  ].includes(value)
    ? value
    : "force_sync";
}

function commandStatusOrDefault(value: string) {
  return ["pending", "sent", "acked", "failed"].includes(value) ? value : "pending";
}

function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return new Date();
  }

  return value instanceof Date ? value : new Date(value);
}

function toNullableDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  return toDate(value);
}

function toIso(value: string | Date | null | undefined) {
  return toDate(value).toISOString();
}

function toIsoOrEmpty(value: string | Date | null | undefined) {
  return value ? toIso(value) : "";
}
