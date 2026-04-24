import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMigrationArgs, summarizeDatabase } from "./migrateJsonToPrisma.js";
import { createEmptyDatabase } from "../storage/prismaDatabase.js";

describe("JSON to Prisma migration CLI", () => {
  it("defaults to a dry run using the production JSON data path", () => {
    const options = parseMigrationArgs([], {}, "/srv/data/app-db.json");

    assert.equal(options.apply, false);
    assert.equal(options.dataFile, "/srv/data/app-db.json");
    assert.equal(options.databaseUrl, "");
  });

  it("requires DATABASE_URL when applying the migration", () => {
    assert.throws(
      () => parseMigrationArgs(["--apply"], {}, "/srv/data/app-db.json"),
      /DATABASE_URL is required/
    );
  });

  it("summarizes raw and importable records", () => {
    const database = createEmptyDatabase();
    database.clients.push({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Client",
      slug: "client",
      brandColor: "#ff6a3c",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.channels.push({
      id: "33333333-3333-4333-8333-333333333333",
      clientId: "missing-client",
      name: "Broken Channel",
      slug: "broken",
      description: "",
      orientation: "landscape",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });

    const summary = summarizeDatabase(database);

    assert.equal(summary.raw.clients, 1);
    assert.equal(summary.raw.channels, 1);
    assert.equal(summary.importable.clients, 1);
    assert.equal(summary.importable.channels, 0);
  });
});
