import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveServerConfig } from "./app.js";

describe("server config", () => {
  it("uses JSON storage by default", () => {
    const config = resolveServerConfig({ env: {} });

    assert.equal(config.storageMode, "json");
    assert.equal(config.databaseUrl, "");
  });

  it("uses Prisma storage when DATABASE_URL is present", () => {
    const config = resolveServerConfig({
      env: {
        DATABASE_URL: "postgresql://signal:deck@localhost:5432/signaldeck"
      }
    });

    assert.equal(config.storageMode, "prisma");
    assert.equal(config.databaseUrl, "postgresql://signal:deck@localhost:5432/signaldeck");
  });
});
