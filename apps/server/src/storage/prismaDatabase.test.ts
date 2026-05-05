import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrismaCreateBatches, createEmptyDatabase, ensurePrismaAdminAccount } from "./prismaDatabase.js";

describe("prisma database helpers", () => {
  it("builds relational create batches from the MVP database shape", () => {
    const database = createEmptyDatabase();
    database.users.push({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      name: "Owner",
      role: "owner",
      passwordHash: "hash",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.clients.push({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Client",
      slug: "client",
      brandColor: "#ff6a3c",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.playlists.push({
      id: "33333333-3333-4333-8333-333333333333",
      clientId: "22222222-2222-4222-8222-222222222222",
      channelId: "",
      name: "Fallback",
      isActive: true,
      notes: "",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });

    const batches = buildPrismaCreateBatches(database);

    assert.equal(batches.users.length, 1);
    assert.equal(batches.clients.length, 1);
    assert.equal(batches.playlists.length, 1);
    assert.equal(batches.playlists[0].channelId, null);
  });

  it("deduplicates relation rows before PostgreSQL createMany", () => {
    const database = createEmptyDatabase();
    database.users.push({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      name: "Owner",
      role: "owner",
      passwordHash: "hash",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.clients.push({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Client",
      slug: "client",
      brandColor: "#ff6a3c",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.locations.push({
      id: "33333333-3333-4333-8333-333333333333",
      clientId: "22222222-2222-4222-8222-222222222222",
      name: "Site",
      city: "",
      address: "",
      notes: "",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z"
    });
    database.userClients.push(
      {
        id: "44444444-4444-4444-8444-444444444441",
        userId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        allLocations: true,
        createdAt: "2026-04-24T10:00:00.000Z"
      },
      {
        id: "44444444-4444-4444-8444-444444444442",
        userId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        allLocations: true,
        createdAt: "2026-04-24T10:00:00.000Z"
      }
    );
    database.userLocationAccesses.push(
      {
        id: "55555555-5555-4555-8555-555555555551",
        userId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        createdAt: "2026-04-24T10:00:00.000Z"
      },
      {
        id: "55555555-5555-4555-8555-555555555552",
        userId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        createdAt: "2026-04-24T10:00:00.000Z"
      }
    );

    const batches = buildPrismaCreateBatches(database);

    assert.equal(batches.userClients.length, 1);
    assert.equal(batches.userLocationAccesses.length, 1);
  });

  it("creates the admin user when it is missing", async () => {
    const created: unknown[] = [];
    const prisma = {
      user: {
        async findUnique() {
          return null;
        },
        async create({ data }: { data: unknown }) {
          created.push(data);
          return data;
        }
      }
    };

    await ensurePrismaAdminAccount(prisma, {
      email: "OWNER@EXAMPLE.TEST",
      name: "Owner",
      password: "strong-password",
      hashPassword: (value) => `hashed:${value}`
    });

    assert.equal(created.length, 1);
    assert.equal((created[0] as { email: string }).email, "owner@example.test");
    assert.equal((created[0] as { role: string }).role, "owner");
    assert.equal((created[0] as { passwordHash: string }).passwordHash, "hashed:strong-password");
  });
});
