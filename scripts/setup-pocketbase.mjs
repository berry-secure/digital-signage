import PocketBase from "pocketbase";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const usage = `
Uzycie:
node scripts/setup-pocketbase.mjs \
  --url https://pb.berry-secure.pl \
  --superuserEmail admin@example.com \
  --superuserPassword "twoje-haslo" \
  --ownerEmail owner@berry-secure.pl \
  --ownerPassword "mocne-haslo" \
  [--ownerName "Berry Owner"] \
  [--ownerRole owner]

Mozesz tez uruchomic sam:
node scripts/setup-pocketbase.mjs

Wtedy skrypt zapyta Cie o brakujace dane.
`;

const args = parseArgs(process.argv.slice(2));

const pb = new PocketBase("https://pb.berry-secure.pl");
pb.autoCancellation(false);

const cmsOnlyRule = '@request.auth.id != "" && @request.auth.collectionName = "cms_users"';
const cmsOrScreenRule =
  '@request.auth.id != "" && (@request.auth.collectionName = "cms_users" || @request.auth.collectionName = "screen_users")';
const screenOwnOrCmsRule = `id = @request.auth.id || (${cmsOnlyRule})`;

async function main() {
  await collectMissingArgs(args);

  if (
    !args.url ||
    !args.superuserEmail ||
    !args.superuserPassword ||
    !args.ownerEmail ||
    !args.ownerPassword
  ) {
    console.error(usage.trim());
    process.exit(1);
  }

  pb.baseUrl = args.url;
  console.log(`Connecting to ${args.url} ...`);
  await pb.collection("_superusers").authWithPassword(args.superuserEmail, args.superuserPassword);
  console.log("Authenticated as PocketBase superuser.");

  const existingCollections = await pb.collections.getFullList();
  const collectionMap = new Map(existingCollections.map((collection) => [collection.name, collection]));

  const clientsCollection = await upsertCollection(collectionMap, "clients", () => ({
    name: "clients",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      { name: "name", type: "text", required: true, min: 2, max: 120 },
      {
        name: "slug",
        type: "text",
        required: true,
        min: 2,
        max: 100,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
      },
      { name: "brandColor", type: "text", required: true, min: 4, max: 16 }
    ],
    indexes: ["CREATE UNIQUE INDEX idx_clients_slug ON clients (slug)"]
  }));

  const channelsCollection = await upsertCollection(collectionMap, "channels", () => ({
    name: "channels",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "name", type: "text", required: true, min: 2, max: 120 },
      {
        name: "slug",
        type: "text",
        required: true,
        min: 2,
        max: 100,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
      },
      { name: "description", type: "text", max: 300 },
      {
        name: "orientation",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["landscape", "portrait"]
      }
    ],
    indexes: ["CREATE INDEX idx_channels_client_slug ON channels (client, slug)"]
  }));

  const cmsUsersCollection = await upsertCollection(collectionMap, "cms_users", () => ({
    name: "cms_users",
    type: "auth",
    authRule: "",
    listRule: cmsOnlyRule,
    viewRule: cmsOnlyRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    manageRule: cmsOnlyRule,
    passwordAuth: {
      enabled: true,
      identityFields: ["email"]
    },
    fields: [
      { name: "name", type: "text", required: true, min: 2, max: 120 },
      {
        name: "role",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["owner", "manager", "editor"]
      },
      {
        name: "client",
        type: "relation",
        collectionId: clientsCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      }
    ]
  }));

  const screenUsersCollection = await upsertCollection(collectionMap, "screen_users", () => ({
    name: "screen_users",
    type: "auth",
    authRule: "",
    listRule: cmsOnlyRule,
    viewRule: screenOwnOrCmsRule,
    createRule: cmsOnlyRule,
    updateRule: screenOwnOrCmsRule,
    deleteRule: cmsOnlyRule,
    manageRule: cmsOnlyRule,
    passwordAuth: {
      enabled: true,
      identityFields: ["email"]
    },
    fields: [
      { name: "name", type: "text", required: true, min: 2, max: 120 },
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "channel",
        type: "relation",
        required: true,
        collectionId: channelsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: false
      },
      { name: "locationLabel", type: "text", required: true, min: 2, max: 180 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["pairing", "online", "offline", "maintenance"]
      },
      { name: "volumePercent", type: "number", required: true, min: 0, max: 100, onlyInt: true },
      { name: "lastSeenAt", type: "date" },
      { name: "lastPlaybackAt", type: "date" },
      { name: "notes", type: "text", max: 500 },
      {
        name: "desiredDisplayState",
        type: "select",
        maxSelect: 1,
        values: ["active", "blackout"]
      },
      { name: "deviceModel", type: "text", max: 180 },
      { name: "appVersion", type: "text", max: 40 },
      {
        name: "lastScreenshot",
        type: "file",
        maxSelect: 1,
        maxSize: 10485760,
        protected: true,
        mimeTypes: []
      },
      { name: "lastScreenshotAt", type: "date" },
      { name: "lastIpAddress", type: "text", max: 80 },
      {
        name: "networkMode",
        type: "select",
        maxSelect: 1,
        values: ["dhcp", "manual"]
      },
      { name: "networkAddress", type: "text", max: 80 },
      { name: "networkGateway", type: "text", max: 80 },
      { name: "networkDns", type: "text", max: 160 },
      { name: "wifiSsid", type: "text", max: 120 },
      { name: "networkNotes", type: "text", max: 500 }
    ],
    indexes: ["CREATE INDEX idx_screen_users_client_channel ON screen_users (client, channel)"]
  }));

  const devicePairingsCollection = await upsertCollection(collectionMap, "device_pairings", () => ({
    name: "device_pairings",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: cmsOnlyRule,
    fields: [
      { name: "installerId", type: "text", required: true, min: 8, max: 80 },
      { name: "pairingCode", type: "text", required: true, min: 4, max: 12 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["waiting", "paired", "claimed", "expired"]
      },
      { name: "deviceName", type: "text", required: true, min: 2, max: 180 },
      { name: "platform", type: "text", max: 80 },
      { name: "appVersion", type: "text", max: 40 },
      { name: "pairingExpiresAt", type: "date" },
      { name: "lastSeenAt", type: "date" },
      {
        name: "client",
        type: "relation",
        collectionId: clientsCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      {
        name: "channel",
        type: "relation",
        collectionId: channelsCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      { name: "locationLabel", type: "text", max: 180 },
      {
        name: "screen",
        type: "relation",
        collectionId: screenUsersCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      { name: "assignedEmail", type: "text", max: 180 },
      { name: "claimedAt", type: "date" }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_device_pairings_installer_id ON device_pairings (installerId)",
      "CREATE UNIQUE INDEX idx_device_pairings_pairing_code ON device_pairings (pairingCode)"
    ]
  }));

  await upsertCollection(collectionMap, "media_assets", () => ({
    name: "media_assets",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "title", type: "text", required: true, min: 2, max: 180 },
      {
        name: "kind",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["video", "image"]
      },
      {
        name: "asset",
        type: "file",
        required: true,
        maxSelect: 1,
        maxSize: 524288000,
        protected: true,
        mimeTypes: []
      },
      { name: "durationSeconds", type: "number", required: true, min: 0, max: 86400 },
      { name: "hasAudio", type: "bool", required: true },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["draft", "published"]
      },
      { name: "tags", type: "text", max: 400 }
    ],
    indexes: ["CREATE INDEX idx_media_assets_client_status ON media_assets (client, status)"]
  }));

  const playlistsCollection = await upsertCollection(collectionMap, "playlists", () => ({
    name: "playlists",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "channel",
        type: "relation",
        collectionId: channelsCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      { name: "name", type: "text", required: true, min: 2, max: 180 },
      { name: "isActive", type: "bool", required: true },
      { name: "notes", type: "text", max: 500 }
    ],
    indexes: ["CREATE INDEX idx_playlists_client_channel ON playlists (client, channel)"]
  }));

  await upsertCollection(collectionMap, "playlist_items", () => ({
    name: "playlist_items",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "playlist",
        type: "relation",
        required: true,
        collectionId: playlistsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "mediaAsset",
        type: "relation",
        required: true,
        collectionId: collectionMap.get("media_assets").id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "sortOrder", type: "number", required: true, min: 0, max: 9999, onlyInt: true },
      { name: "loopCount", type: "number", required: true, min: 1, max: 99, onlyInt: true },
      { name: "volumePercent", type: "number", required: true, min: 0, max: 100, onlyInt: true }
    ],
    indexes: ["CREATE INDEX idx_playlist_items_playlist_order ON playlist_items (playlist, sortOrder)"]
  }));

  await upsertCollection(collectionMap, "schedule_rules", () => ({
    name: "schedule_rules",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "channel",
        type: "relation",
        required: true,
        collectionId: channelsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "playlist",
        type: "relation",
        required: true,
        collectionId: playlistsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "label", type: "text", required: true, min: 2, max: 180 },
      { name: "startDate", type: "date" },
      { name: "endDate", type: "date" },
      { name: "startTime", type: "text", required: true, min: 4, max: 5, pattern: "^\\d{2}:\\d{2}$" },
      { name: "endTime", type: "text", required: true, min: 4, max: 5, pattern: "^\\d{2}:\\d{2}$" },
      { name: "daysOfWeek", type: "text", max: 30 },
      { name: "priority", type: "number", required: true, min: 0, max: 9999, onlyInt: true },
      { name: "isActive", type: "bool", required: true }
    ],
    indexes: ["CREATE INDEX idx_schedule_rules_channel_priority ON schedule_rules (channel, priority)"]
  }));

  await upsertCollection(collectionMap, "events", () => ({
    name: "events",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOnlyRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "client",
        type: "relation",
        required: true,
        collectionId: clientsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "channel",
        type: "relation",
        collectionId: channelsCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      {
        name: "screen",
        type: "relation",
        collectionId: screenUsersCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      },
      {
        name: "playlist",
        type: "relation",
        required: true,
        collectionId: playlistsCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "title", type: "text", required: true, min: 2, max: 180 },
      { name: "message", type: "text", max: 500 },
      { name: "startsAt", type: "date", required: true },
      { name: "endsAt", type: "date", required: true },
      { name: "priority", type: "number", required: true, min: 0, max: 9999, onlyInt: true },
      { name: "isActive", type: "bool", required: true }
    ],
    indexes: ["CREATE INDEX idx_events_client_priority ON events (client, priority)"]
  }));

  await upsertCollection(collectionMap, "device_commands", () => ({
    name: "device_commands",
    type: "base",
    listRule: cmsOrScreenRule,
    viewRule: cmsOrScreenRule,
    createRule: cmsOnlyRule,
    updateRule: cmsOrScreenRule,
    deleteRule: cmsOnlyRule,
    fields: [
      {
        name: "screen",
        type: "relation",
        required: true,
        collectionId: screenUsersCollection.id,
        minSelect: 1,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "commandType",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["sync", "capture_screenshot", "blackout", "wake", "restart_app"]
      },
      { name: "payload", type: "text", max: 4000 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["queued", "processing", "done", "failed"]
      },
      { name: "resultMessage", type: "text", max: 500 },
      { name: "processedAt", type: "date" },
      { name: "expiresAt", type: "date" },
      {
        name: "issuedBy",
        type: "relation",
        collectionId: cmsUsersCollection.id,
        minSelect: 0,
        maxSelect: 1,
        cascadeDelete: false
      }
    ],
    indexes: [
      "CREATE INDEX idx_device_commands_screen_status ON device_commands (screen, status)"
    ]
  }));

  await upsertOwner(cmsUsersCollection.name, {
    email: args.ownerEmail,
    password: args.ownerPassword,
    name: args.ownerName || "Berry Secure Owner",
    role: args.ownerRole || "owner"
  });

  console.log("");
  console.log("PocketBase schema is ready.");
  console.log(`CMS login: ${args.ownerEmail}`);
  console.log("Next step: open https://cms.berry-secure.pl and log in.");
}

async function upsertCollection(collectionMap, name, buildPayload) {
  const payload = buildPayload();
  const existing = collectionMap.get(name);

  try {
    if (existing) {
      const updated = await pb.collections.update(existing.id, payload);
      collectionMap.set(name, updated);
      console.log(`Updated collection: ${name}`);
      return updated;
    }

    const created = await pb.collections.create(payload);
    collectionMap.set(name, created);
    console.log(`Created collection: ${name}`);
    return created;
  } catch (error) {
    console.error(`Collection upsert failed for: ${name}`);
    console.error("Payload:");
    console.error(JSON.stringify(payload, null, 2));
    if (error?.response) {
      console.error("PocketBase response:");
      console.error(JSON.stringify(error.response, null, 2));
    }
    throw error;
  }
}

async function upsertOwner(collectionName, data) {
  const filter = `email="${escapeFilterValue(data.email)}"`;
  let existing = null;

  try {
    existing = await pb.collection(collectionName).getFirstListItem(filter);
  } catch {
    existing = null;
  }

  if (existing) {
    await pb.collection(collectionName).update(existing.id, {
      name: data.name,
      role: data.role
    });
    console.log(`Owner user already exists: ${data.email}`);
    return;
  }

  await pb.collection(collectionName).create({
    email: data.email,
    password: data.password,
    passwordConfirm: data.password,
    name: data.name,
    role: data.role
  });

  console.log(`Created owner user: ${data.email}`);
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = stripWrappingQuotes(next);
    index += 1;
  }

  return result;
}

async function collectMissingArgs(target) {
  const rl = readline.createInterface({ input, output });

  try {
    target.url = target.url || stripWrappingQuotes(await ask(rl, "PocketBase URL", "https://pb.berry-secure.pl"));
    target.superuserEmail =
      target.superuserEmail || stripWrappingQuotes(await ask(rl, "Superuser email"));
    target.superuserPassword =
      target.superuserPassword || stripWrappingQuotes(await ask(rl, "Superuser password"));
    target.ownerEmail =
      target.ownerEmail || stripWrappingQuotes(await ask(rl, "CMS owner email", "cms@berry-secure.pl"));
    target.ownerPassword =
      target.ownerPassword || stripWrappingQuotes(await ask(rl, "CMS owner password"));
    target.ownerName =
      target.ownerName || stripWrappingQuotes(await ask(rl, "CMS owner name", "Berry Secure Owner"));
    target.ownerRole =
      target.ownerRole || stripWrappingQuotes(await ask(rl, "CMS owner role", "owner"));
  } finally {
    rl.close();
  }
}

async function ask(rl, label, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const value = await rl.question(`${label}${suffix}: `);
  return value.trim() || fallback;
}

function escapeFilterValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function stripWrappingQuotes(value) {
  return String(value)
    .trim()
    .replace(/^["'`„”‚‘’]+/, "")
    .replace(/["'`„”‚‘’]+$/, "");
}

main().catch((error) => {
  console.error("");
  console.error("PocketBase setup failed.");
  console.error(formatSetupError(error));
  process.exit(1);
});

function formatSetupError(error) {
  const cause = error?.cause || error?.originalError?.cause || error?.originalError;

  if (cause?.code === "ENOTFOUND" && cause?.hostname) {
    return `Nie mozna odnalezc hosta "${cause.hostname}". Sprawdz literowke w adresie PocketBase.`;
  }

  if (error?.status === 400 && error?.response?.message === "Failed to authenticate.") {
    return "PocketBase odrzucil logowanie superusera. Sprawdz email i haslo superusera.";
  }

  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}
