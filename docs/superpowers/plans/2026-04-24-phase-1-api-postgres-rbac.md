# Phase 1 API PostgreSQL RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the MVP backend toward a typed TypeScript API with PostgreSQL/Prisma data modeling and RBAC while preserving the current CMS and Android TV player HTTP contract.

**Architecture:** First keep the working API surface stable and type the current server behind an Express app factory so it can be tested without a listening socket. Add RBAC as explicit policy functions used by routes, and add a Prisma PostgreSQL schema that mirrors current MVP records before swapping runtime persistence fully to Prisma in the next vertical slice.

**Tech Stack:** TypeScript, Express 5, Multer, Node test runner, tsx, Prisma, PostgreSQL.

---

### Task 1: Baseline Verification

**Files:**
- Read: `package.json`
- Read: `apps/player/package.json`
- Read: `apps/cms/package.json`

- [x] **Step 1: Verify web MVP build**

Run: `npm run build`

Expected: CMS and player Vite builds complete with exit code 0.

- [x] **Step 2: Verify Android debug APK build**

Run: `npm run build:android:debug`

Expected: Capacitor sync completes and Gradle reports `BUILD SUCCESSFUL`.

### Task 2: Add Backend Test Harness

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/http/types.ts`
- Test: `apps/server/src/rbac.test.ts`

- [x] **Step 1: Add a failing RBAC unit test**

Create `apps/server/src/rbac.test.ts` with Node test runner assertions for owner, manager and editor permissions:

```ts
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
```

- [x] **Step 2: Run the test and verify it fails**

Run: `npm run test --workspace @ds/server`

Expected: FAIL because `./security/rbac.js` does not exist yet.

- [x] **Step 3: Implement the minimal RBAC module**

Create `apps/server/src/security/rbac.ts` with pure role policy functions used by tests and routes.

- [x] **Step 4: Run the test and verify it passes**

Run: `npm run test --workspace @ds/server`

Expected: PASS for RBAC policy tests.

### Task 3: Type the Existing Express Server

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/storage/jsonDatabase.ts`
- Create: `apps/server/src/storage/uploads.ts`
- Create: `apps/server/src/types.ts`
- Modify: `apps/server/server.js`

- [x] **Step 1: Move runtime code into `createApp()`**

Move the current Express route behavior into `apps/server/src/app.ts` and export an async `createApp(config)` function. Keep endpoint paths and response shapes unchanged.

- [x] **Step 2: Keep `server.js` as a compatibility shim**

Replace `apps/server/server.js` with a small import that starts the compiled TypeScript server from `dist/index.js`, so deployment commands can continue using `npm run start --workspace @ds/server`.

- [x] **Step 3: Build the server**

Run: `npm run build --workspace @ds/server`

Expected: TypeScript emits `dist/` with no type errors.

### Task 4: Add Prisma PostgreSQL Schema

**Files:**
- Create: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/package.json`
- Modify: `package.json`

- [x] **Step 1: Add Prisma dependencies and scripts**

Install `@prisma/client` as a server dependency and `prisma` as a server dev dependency. Add scripts `prisma:generate`, `prisma:migrate:dev` and `prisma:studio`.

- [x] **Step 2: Create the schema**

Create PostgreSQL models for `User`, `Client`, `UserClient`, `Channel`, `Media`, `Playlist`, `PlaylistItem`, `Schedule`, `Device`, `Session` and `AuditLog`. Include enums for user role, media kind, media status, device approval status, display state and player state.

- [x] **Step 3: Generate Prisma client**

Run: `npm run prisma:generate --workspace @ds/server`

Expected: Prisma client generation succeeds when `DATABASE_URL` is present or schema validation succeeds without a live database.

### Task 5: Preserve CMS and Player Contract

**Files:**
- Test: `apps/server/src/api-contract.test.ts`
- Modify: `apps/server/src/app.ts`

- [x] **Step 1: Add contract tests for auth/bootstrap and player session**

Use a temporary `DATA_DIR` and Supertest to assert:

```ts
assert.equal(login.status, 200);
assert.equal(bootstrap.status, 200);
assert.ok(Array.isArray(bootstrap.body.clients));
assert.equal(playerSession.status, 200);
assert.equal(playerSession.body.approvalStatus, "pending");
assert.equal(playerSession.body.playback.mode, "idle");
```

- [x] **Step 2: Run the contract tests and verify they pass**

Run: `npm run test --workspace @ds/server`

Expected: PASS for RBAC and API contract tests.

### Task 6: Final Verification

**Files:**
- Read: `package.json`
- Read: `apps/server/package.json`
- Read: `apps/cms/package.json`
- Read: `apps/player/package.json`

- [x] **Step 1: Verify full build**

Run: `npm run build`

Expected: CMS, player and server builds complete with exit code 0.

- [x] **Step 2: Verify APK debug build**

Run: `npm run build:android:debug`

Expected: Gradle reports `BUILD SUCCESSFUL`.

- [x] **Step 3: Review diff**

Run: `git diff --stat && git diff --check`

Expected: Expected server/docs/package changes only, and no whitespace errors.
