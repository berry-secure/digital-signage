import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canManageClientData, canManageUsers } from "./security/rbac.js";

describe("rbac policies", () => {
  it("allows only owners to manage users", () => {
    assert.equal(canManageUsers({ role: "owner", clientIds: [] }), true);
    assert.equal(canManageUsers({ role: "manager", clientIds: [] }), false);
    assert.equal(canManageUsers({ role: "editor", clientIds: [] }), false);
  });

  it("scopes managers and editors to assigned clients", () => {
    assert.equal(canManageClientData({ role: "owner", clientIds: [] }, "client-a"), true);
    assert.equal(canManageClientData({ role: "manager", clientIds: ["client-a"] }, "client-a"), true);
    assert.equal(canManageClientData({ role: "manager", clientIds: ["client-b"] }, "client-a"), false);
    assert.equal(canManageClientData({ role: "editor", clientIds: ["client-a"] }, "client-a"), true);
    assert.equal(canManageClientData({ role: "editor", clientIds: [] }, "client-a"), false);
  });
});
