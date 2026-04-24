import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPrismaCreateBatches,
  createPrismaClient,
  persistPrismaDatabase
} from "../storage/prismaDatabase.js";

type MigrationOptions = {
  apply: boolean;
  dataFile: string;
  databaseUrl: string;
};

type MigrationSummary = {
  raw: Record<string, number>;
  importable: Record<string, number>;
};

const currentFile = fileURLToPath(import.meta.url);

export function parseMigrationArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  defaultDataFile = resolve(process.cwd(), "../../data/app-db.json")
): MigrationOptions {
  const options: MigrationOptions = {
    apply: false,
    dataFile: defaultDataFile,
    databaseUrl: String(env.DATABASE_URL || "").trim()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--data") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--data requires a path to app-db.json.");
      }
      options.dataFile = resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--database-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--database-url requires a PostgreSQL connection string.");
      }
      options.databaseUrl = value.trim();
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.apply && !options.databaseUrl) {
    throw new Error("DATABASE_URL is required when using --apply.");
  }

  return options;
}

export function summarizeDatabase(database: any): MigrationSummary {
  const batches = buildPrismaCreateBatches(database);

  return {
    raw: {
      users: count(database.users),
      clients: count(database.clients),
      channels: count(database.channels),
      media: count(database.media),
      playlists: count(database.playlists),
      playlistItems: count(database.playlistItems),
      schedules: count(database.schedules),
      devices: count(database.devices)
    },
    importable: {
      users: batches.users.length,
      clients: batches.clients.length,
      channels: batches.channels.length,
      media: batches.media.length,
      playlists: batches.playlists.length,
      playlistItems: batches.playlistItems.length,
      schedules: batches.schedules.length,
      devices: batches.devices.length
    }
  };
}

export async function runJsonToPrismaMigration(options: MigrationOptions) {
  if (!existsSync(options.dataFile)) {
    throw new Error(`JSON database not found: ${options.dataFile}`);
  }

  const database = JSON.parse(await readFile(options.dataFile, "utf8"));
  const summary = summarizeDatabase(database);

  if (!options.apply) {
    return {
      applied: false,
      summary
    };
  }

  const prisma = createPrismaClient(options.databaseUrl);
  try {
    await persistPrismaDatabase(prisma, database);
  } finally {
    if (typeof (prisma as any).$disconnect === "function") {
      await (prisma as any).$disconnect();
    }
  }

  return {
    applied: true,
    summary
  };
}

function count(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function usage() {
  return `
Usage:
  npm run migrate:json:postgres -- --data /path/to/app-db.json
  DATABASE_URL="postgresql://..." npm run migrate:json:postgres -- --data /path/to/app-db.json --apply

Defaults:
  Without --apply this command only prints a dry-run summary.
  --apply requires DATABASE_URL or --database-url.
`.trim();
}

async function main() {
  try {
    const options = parseMigrationArgs(process.argv.slice(2));
    const result = await runJsonToPrismaMigration(options);
    console.log(result.applied ? "Applied JSON -> PostgreSQL migration." : "Dry run only. No database writes.");
    console.table(result.summary.raw);
    console.table(result.summary.importable);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await main();
}
