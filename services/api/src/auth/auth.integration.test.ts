import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_HEADER, WORKSPACE_HEADER } from "@vulto/schema";
import { db, closeDatabase } from "../db.js";
import { buildServer } from "../server.js";
import {
  account,
  device,
  deviceTrustEvent,
  deviceWorkspaceRevocation,
  member,
  organization,
  session,
  user,
} from "./schema.js";
import { roleChangeDirection } from "./workspace-projection.js";
import {
  admitWorkspaceMember,
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
  requireCurrentWorkspaceSession,
  revokeWorkspaceAdmission,
  suspendUserAndRevokeSessions,
  UnauthorizedWorkspaceSessionError,
} from "./workspace-session.js";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Correct horse battery staple 60!";
const SENSITIVE_KEYS = new Set([
  "token",
  "sessionToken",
  "accessToken",
  "refreshToken",
  "idToken",
]);

const app = await buildServer();

function json(response: LightMyRequestResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function cookieHeader(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function sensitiveKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => sensitiveKeys(item, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) found.push(key);
      sensitiveKeys(child, found);
    }
  }
  return found;
}

async function signUp(email: string, name = "Avery Stone") {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: PASSWORD },
  });
}

async function signIn(email: string, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
}

async function createSignedInAccount(email = `${randomUUID()}@example.com`) {
  expect((await signUp(email)).statusCode).toBe(200);
  const response = await signIn(email);
  expect(response.statusCode).toBe(200);
  const cookie = cookieHeader(response);
  expect(cookie).toContain("better-auth.session_token=");

  const [createdUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`${user.email} = ${email}`);
  if (!createdUser) throw new Error("Expected account to exist");
  return { cookie, email, userId: createdUser.id, response };
}

async function addWorkspace(
  userId: string,
  slug: string,
  confirmed = true,
  roles: ("owner" | "hr-admin" | "finance-admin" | "team-member")[] = ["team-member"],
) {
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  await createPendingWorkspaceAdmission({
    workspaceId,
    workspaceName: slug,
    workspaceSlug: slug,
    membershipId,
    userId,
    roles,
  });
  if (confirmed) await confirmWorkspaceAdmission(membershipId);
  return { workspaceId, membershipId };
}

function headers(cookie: string): Headers {
  return new Headers({ cookie, origin: ORIGIN });
}

/**
 * FDN-63 Stage 3. The unlock checkpoint now refuses a device with no
 * registration row, so every direct `/device-store/unlock` inject must
 * register first — the same order the graph client's `unlockOnline` follows.
 */
async function injectRegisterDevice(cookie: string, deviceId: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/devices/register",
    headers: { origin: ORIGIN, cookie },
    payload: { deviceId, deviceName: "Test device", platform: "web" },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/**
 * Asks the shape proxy whether this device is acceptable to this workspace right
 * now: 200 when it is, 401 `access-revoked` when it is not. It is the one place
 * a device's standing is decided, so it is what these tests probe. The upstream
 * is a stand-in that always answers 200.
 */
async function probe(cookie: string, workspaceId: string, id: string) {
  return app.inject({
    method: "GET",
    url: "/v1/shape/nodes?offset=-1",
    headers: {
      origin: ORIGIN,
      cookie,
      [WORKSPACE_HEADER]: workspaceId,
      [DEVICE_HEADER]: id,
    },
  });
}

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "electric-handle": "stub" },
      }),
  );
});

beforeEach(async () => {
  await db.execute(
    sql.raw(`
    TRUNCATE TABLE
      "device_trust_event", "device", "passkey_registration_context", "passkey",
      "invitation", "member", "organization", "session", "account",
      "verification", "user", "rate_limit"
    RESTART IDENTITY CASCADE
  `),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await closeDatabase();
});

describe("account and browser-session boundary", () => {
  it("stores scrypt credentials, returns no credential in JSON, and sets a host cookie", async () => {
    const created = await createSignedInAccount();
    expect(sensitiveKeys(json(created.response))).toEqual([]);

    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(sql`${account.userId} = ${created.userId}`);
    expect(credential?.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(
      await verifyPassword({ hash: credential!.password!, password: PASSWORD }),
    ).toBe(true);
    expect(
      await verifyPassword({
        hash: credential!.password!,
        password: "Not the password 60!",
      }),
    ).toBe(false);

    const setCookie = created.response.headers["set-cookie"];
    const rendered = Array.isArray(setCookie) ? setCookie.join("\n") : setCookie;
    expect(rendered).toContain("HttpOnly");
    expect(rendered).toContain("SameSite=Lax");
    expect(rendered).not.toContain("Domain=");
  });

  it("does not reveal whether an email exists during password sign-in", async () => {
    const email = `${randomUUID()}@example.com`;
    expect((await signUp(email)).statusCode).toBe(200);

    const known = await signIn(email, "Not the password 60!");
    const unknown = await signIn(`${randomUUID()}@example.com`, "Not the password 60!");
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(json(known)).toEqual(json(unknown));
  });

  it("restores a database session from a retained cookie and fails after deletion", async () => {
    const created = await createSignedInAccount();
    const before = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: created.cookie, origin: ORIGIN },
    });
    expect(before.statusCode).toBe(200);
    expect(json(before).user).toMatchObject({ email: created.email });
    expect(sensitiveKeys(json(before))).toEqual([]);

    await db.delete(session).where(sql`${session.userId} = ${created.userId}`);
    const after = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: created.cookie, origin: ORIGIN },
    });
    expect(after.statusCode).toBe(200);
    expect(after.body).toBe("null");
  });

  it("creates seven-day sessions and refreshes after one day of use", async () => {
    const created = await createSignedInAccount();
    const [initial] = await db
      .select()
      .from(session)
      .where(sql`${session.userId} = ${created.userId}`);
    if (!initial) throw new Error("Expected session");
    const initialLifetime = initial.expiresAt.getTime() - initial.createdAt.getTime();
    expect(initialLifetime).toBeGreaterThanOrEqual(7 * 86_400_000 - 5_000);
    expect(initialLifetime).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);

    const staleUpdate = new Date(Date.now() - 2 * 86_400_000);
    await db
      .update(session)
      .set({ updatedAt: staleUpdate, expiresAt: new Date(Date.now() + 86_400_000) })
      .where(sql`${session.id} = ${initial.id}`);

    await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: created.cookie, origin: ORIGIN },
    });
    const [refreshed] = await db
      .select()
      .from(session)
      .where(sql`${session.id} = ${initial.id}`);
    expect(refreshed?.updatedAt.getTime()).toBeGreaterThan(staleUpdate.getTime());
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(sql`${session.id} = ${initial.id}`);
    const expired = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: created.cookie, origin: ORIGIN },
    });
    expect(expired.body).toBe("null");
  });

  it("signs out the current session and can revoke all sessions", async () => {
    const created = await createSignedInAccount();
    const second = await signIn(created.email);
    const secondCookie = cookieHeader(second);

    const signedOut = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie: created.cookie, origin: ORIGIN },
    });
    expect(signedOut.statusCode).toBe(200);

    const revokeAll = await app.inject({
      method: "POST",
      url: "/api/auth/revoke-sessions",
      headers: { cookie: secondCookie, origin: ORIGIN },
    });
    expect(revokeAll.statusCode).toBe(200);
    const remaining = await db
      .select({ id: session.id })
      .from(session)
      .where(sql`${session.userId} = ${created.userId}`);
    expect(remaining).toEqual([]);
  });
});

describe("exact-workspace revocation guard", () => {
  it("keeps pending grants closed, then admits only after confirmation", async () => {
    const created = await createSignedInAccount();
    const workspace = await addWorkspace(
      created.userId,
      `pending-${randomUUID()}`,
      false,
    );

    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspace.workspaceId),
    ).rejects.toBeInstanceOf(UnauthorizedWorkspaceSessionError);
    await confirmWorkspaceAdmission(workspace.membershipId);
    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspace.workspaceId),
    ).resolves.toMatchObject({
      userId: created.userId,
      workspaceId: workspace.workspaceId,
      membershipId: workspace.membershipId,
    });
  });

  it("denies one revoked workspace immediately and preserves another", async () => {
    const created = await createSignedInAccount();
    const workspaceA = await addWorkspace(created.userId, `a-${randomUUID()}`);
    const workspaceB = await addWorkspace(created.userId, `b-${randomUUID()}`);

    await revokeWorkspaceAdmission(workspaceA.membershipId, randomUUID());
    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspaceA.workspaceId),
    ).rejects.toBeInstanceOf(UnauthorizedWorkspaceSessionError);
    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspaceB.workspaceId),
    ).resolves.toMatchObject({ workspaceId: workspaceB.workspaceId });

    const [revoked] = await db
      .select({ status: member.status, projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${workspaceA.membershipId}`);
    // One transaction: nothing is left waiting on a device to confirm it.
    expect(revoked).toEqual({ status: "revoked", projectionState: "confirmed" });
  });

  it("suspends the account, deletes every session, and refuses a new login", async () => {
    const created = await createSignedInAccount();
    const workspaceA = await addWorkspace(created.userId, `a-${randomUUID()}`);
    const workspaceB = await addWorkspace(created.userId, `b-${randomUUID()}`);

    await suspendUserAndRevokeSessions(created.userId);
    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspaceA.workspaceId),
    ).rejects.toBeInstanceOf(UnauthorizedWorkspaceSessionError);
    await expect(
      requireCurrentWorkspaceSession(headers(created.cookie), workspaceB.workspaceId),
    ).rejects.toBeInstanceOf(UnauthorizedWorkspaceSessionError);
    expect(
      await db
        .select({ id: session.id })
        .from(session)
        .where(sql`${session.userId} = ${created.userId}`),
    ).toEqual([]);
    expect((await signIn(created.email)).statusCode).toBe(401);
  });
});

describe("hostile request boundaries", () => {
  it("rejects untrusted origins and does not grant credentialed CORS", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "https://attacker.invalid" },
      payload: { email: "nobody@example.com", password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();

    const allowedPreflight = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/sign-in/email",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(allowedPreflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(allowedPreflight.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects a cookie-bearing state change without an Origin", async () => {
    const created = await createSignedInAccount();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/revoke-sessions",
      headers: { cookie: created.cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("keeps organization and invitation mutation routes closed", async () => {
    const created = await createSignedInAccount();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { cookie: created.cookie, origin: ORIGIN },
      payload: { name: "Not allowed", slug: "not-allowed" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("requires a trusted origin and an untampered single-use passkey context", async () => {
    const untrusted = await app.inject({
      method: "POST",
      url: "/api/auth/passkey/registration-context",
      headers: { origin: "https://attacker.invalid" },
      payload: { name: "Avery Stone", email: `${randomUUID()}@example.com` },
    });
    expect(untrusted.statusCode).toBe(403);

    const contextResponse = await app.inject({
      method: "POST",
      url: "/api/auth/passkey/registration-context",
      headers: { origin: ORIGIN },
      payload: { name: "Avery Stone", email: `${randomUUID()}@example.com` },
    });
    expect(contextResponse.statusCode).toBe(200);
    const context = json(contextResponse).context;
    expect(typeof context).toBe("string");

    const tampered = await app.inject({
      method: "GET",
      url: `/api/auth/passkey/generate-register-options?context=${encodeURIComponent(`${context}x`)}`,
      headers: { origin: ORIGIN },
    });
    expect(tampered.statusCode).toBe(400);
  });

  it("rate-limits repeated password and passkey registration attempts", async () => {
    const passwordStatuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      passwordStatuses.push(
        (await signIn(`${randomUUID()}@example.com`, "Wrong password 60!")).statusCode,
      );
    }
    expect(passwordStatuses).toContain(429);

    await db.execute(sql.raw('TRUNCATE TABLE "rate_limit"'));
    const passkeyAuthenticationStatuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      passkeyAuthenticationStatuses.push(
        (
          await app.inject({
            method: "GET",
            url: "/api/auth/passkey/generate-authenticate-options",
            headers: { origin: ORIGIN },
          })
        ).statusCode,
      );
    }
    expect(passkeyAuthenticationStatuses).toContain(429);

    await db.execute(sql.raw('TRUNCATE TABLE "rate_limit"'));
    const passkeyStatuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      passkeyStatuses.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/passkey/registration-context",
            headers: { origin: ORIGIN },
            payload: {
              name: "Avery Stone",
              email: `${randomUUID()}@example.com`,
            },
          })
        ).statusCode,
      );
    }
    expect(passkeyStatuses).toEqual([200, 200, 200, 429]);
  });
});

/**
 * FDN-63 Stage 1 — the canonical Device identity record. `VPS-F001`'s
 * `device.register` / `device.listForWorkspace` contract, over real Postgres.
 */
describe("FDN-63 — device registration and per-workspace listing", () => {
  const deviceId = () => `fdn63-device-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  async function register(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: "POST",
      url: "/devices/register",
      headers: { origin: ORIGIN, cookie },
      payload: body,
    });
  }

  it("registers a device carrying VPS-F001's nine fields and echoes its id", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const id = deviceId();
    const response = await register(cookie, {
      deviceId: id,
      deviceName: "Avery's MacBook",
      platform: "macos",
      pushToken: null,
    });
    expect(response.statusCode).toBe(200);
    expect(json(response).deviceId).toBe(id);

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row).toMatchObject({
      id,
      userId,
      deviceName: "Avery's MacBook",
      platform: "macos",
      application: "VultoRoster",
      pushToken: null,
      isRevoked: false,
    });
    expect(row?.registeredAt).toBeInstanceOf(Date);
    expect(row?.lastActiveAt).toBeInstanceOf(Date);
  });

  it("writes an append-only 'registered' trust event on first registration only", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const id = deviceId();
    await register(cookie, { deviceId: id, deviceName: "Device", platform: "web" });
    await register(cookie, { deviceId: id, deviceName: "Renamed", platform: "web" });

    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "registered",
      userId,
      actorUserId: userId,
      workspaceId: null,
    });
  });

  it("mints a device id when the client supplies none", async () => {
    const { cookie } = await createSignedInAccount();
    const response = await register(cookie, {
      deviceName: "First device",
      platform: "web",
    });
    expect(response.statusCode).toBe(200);
    const minted = json(response).deviceId as string;
    expect(minted).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("is idempotent: re-registering updates mutable fields and keeps one row", async () => {
    const { cookie } = await createSignedInAccount();
    const id = deviceId();
    await register(cookie, { deviceId: id, deviceName: "Old name", platform: "web" });
    const second = await register(cookie, {
      deviceId: id,
      deviceName: "New name",
      platform: "web",
      pushToken: "apns-token",
    });
    expect(second.statusCode).toBe(200);

    const rows = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceName).toBe("New name");
    expect(rows[0]?.pushToken).toBe("apns-token");
  });

  it("re-registering does NOT clear is_revoked", async () => {
    const { cookie } = await createSignedInAccount();
    const id = deviceId();
    await register(cookie, { deviceId: id, deviceName: "Device", platform: "web" });
    await db
      .update(device)
      .set({ isRevoked: true })
      .where(sql`${device.id} = ${id}`);
    await register(cookie, {
      deviceId: id,
      deviceName: "Device renamed",
      platform: "web",
    });
    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row?.isRevoked).toBe(true);
  });

  it("rejects an unauthenticated registration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/devices/register",
      headers: { origin: ORIGIN },
      payload: { deviceName: "No session", platform: "web" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects registering a device id that belongs to another user", async () => {
    const first = await createSignedInAccount();
    const id = deviceId();
    await register(first.cookie, { deviceId: id, deviceName: "Mine", platform: "web" });

    const second = await createSignedInAccount();
    const response = await register(second.cookie, {
      deviceId: id,
      deviceName: "Not yours",
      platform: "web",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid platform", async () => {
    const { cookie } = await createSignedInAccount();
    const response = await register(cookie, {
      deviceName: "Bad platform",
      platform: "toaster",
    });
    expect(response.statusCode).toBe(400);
  });

  it("an Owner lists every device with an unlock secret in the workspace; a non-Owner sees only their own", async () => {
    const owner = await createSignedInAccount();
    const workspace = await addWorkspace(
      owner.userId,
      `fdn63-list-${randomUUID()}`,
      true,
      ["owner"],
    );

    const member2 = await createSignedInAccount();
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: workspace.workspaceId,
      userId: member2.userId,
      role: "team-member",
      createdAt: new Date(),
      status: "active",
      projectionState: "confirmed",
    });

    const ownerDevice = deviceId();
    const memberDevice = deviceId();
    await register(owner.cookie, {
      deviceId: ownerDevice,
      deviceName: "Owner laptop",
      platform: "macos",
    });
    await register(member2.cookie, {
      deviceId: memberDevice,
      deviceName: "Member laptop",
      platform: "windows",
    });
    // Both devices "enter" the workspace by unlocking it.
    for (const [cookie, id] of [
      [owner.cookie, ownerDevice],
      [member2.cookie, memberDevice],
    ] as const) {
      const unlock = await probe(cookie, workspace.workspaceId, id);
      expect(unlock.statusCode).toBe(200);
    }

    const ownerList = await app.inject({
      method: "POST",
      url: "/devices/list",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId: workspace.workspaceId },
    });
    expect(ownerList.statusCode).toBe(200);
    const ownerSeen = (json(ownerList).devices as { deviceId: string }[]).map(
      (d) => d.deviceId,
    );
    expect(ownerSeen.sort()).toEqual([ownerDevice, memberDevice].sort());

    const memberList = await app.inject({
      method: "POST",
      url: "/devices/list",
      headers: { origin: ORIGIN, cookie: member2.cookie },
      payload: { workspaceId: workspace.workspaceId },
    });
    expect(memberList.statusCode).toBe(200);
    const memberSeen = (json(memberList).devices as { deviceId: string }[]).map(
      (d) => d.deviceId,
    );
    expect(memberSeen).toEqual([memberDevice]);
    expect(
      json(ownerList).viewerIsOwner,
      "the listing states the caller's Owner capability so the screen need not guess",
    ).toBe(true);
    expect(json(memberList).viewerIsOwner).toBe(false);
  });
});

/**
 * FDN-63 Stage 3 — the trust gate on unlock and the revocation cascades onto
 * the canonical `device` row. Paired with the browser spec's erase/no-erase
 * proof; this half is the server-side state and audit trail.
 */
describe("FDN-63 — device trust gate and revocation cascade", () => {
  const deviceId = () => `fdn63s3-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  const unlock = probe;

  it("denies unlock for a device that never registered", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(userId, `fdn63s3-unreg-${randomUUID()}`);
    const response = await unlock(cookie, workspaceId, deviceId());
    expect(response.statusCode).toBe(401);
  });

  it("denies unlock for a revoked device even when its unlock secret is not revoked", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(userId, `fdn63s3-rev-${randomUUID()}`);
    const id = deviceId();
    await injectRegisterDevice(cookie, id);
    expect((await unlock(cookie, workspaceId, id)).statusCode).toBe(200);

    // The device identity is revoked; no workspace revocation row exists.
    await db
      .update(device)
      .set({ isRevoked: true })
      .where(sql`${device.id} = ${id}`);
    const rows = await db
      .select()
      .from(deviceWorkspaceRevocation)
      .where(sql`${deviceWorkspaceRevocation.deviceId} = ${id}`);
    expect(rows).toEqual([]);

    expect((await unlock(cookie, workspaceId, id)).statusCode).toBe(401);
  });

  it("an Owner's revoke is workspace-scoped: it never touches the global device row (F191)", async () => {
    const owner = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      owner.userId,
      `fdn63s3-revoke-${randomUUID()}`,
      true,
      ["owner"],
    );
    const id = deviceId();
    await app.inject({
      method: "POST",
      url: "/devices/register",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { deviceId: id, deviceName: "D", platform: "web", pushToken: "apns" },
    });
    expect((await unlock(owner.cookie, workspaceId, id)).statusCode).toBe(200);

    const first = await app.inject({
      method: "POST",
      url: "/devices/revoke",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/devices/revoke",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
    expect(second.statusCode).toBe(200);

    // F191. The workspace's revocation is recorded; the GLOBAL identity row is not.
    const [revocation] = await db
      .select()
      .from(deviceWorkspaceRevocation)
      .where(sql`${deviceWorkspaceRevocation.deviceId} = ${id}`);
    expect(revocation).toMatchObject({ workspaceId, deviceId: id, reason: "explicit" });
    expect(revocation?.revokedBy).toBe(owner.userId);

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(
      row?.isRevoked,
      "an Owner may not retire a device globally — that authority is the device owner's alone",
    ).toBe(false);
    expect(
      row?.pushToken,
      "and may not invalidate a device-global push token from one workspace",
    ).toBe("apns");

    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    const revokeEvents = events.filter((e) => e.eventType === "revoked-explicit");
    expect(revokeEvents).toHaveLength(1);
    expect(revokeEvents[0]?.actorUserId).toBe(owner.userId);
    expect(
      revokeEvents[0]?.workspaceId,
      "the audit row records the scope the action actually had",
    ).toBe(workspaceId);
  });

  /**
   * F191's flagship pair, at the API layer. One physical device, two
   * workspaces. An Owner of A revoking it must leave B's access completely
   * intact — otherwise one tenant can destroy another tenant's local data.
   */
  it("an Owner's revoke in workspace A leaves the same device's workspace B unlockable", async () => {
    const owner = await createSignedInAccount();
    const a = await addWorkspace(owner.userId, `fdn63-x-a-${randomUUID()}`, true, [
      "owner",
    ]);
    const b = await addWorkspace(owner.userId, `fdn63-x-b-${randomUUID()}`, true, [
      "owner",
    ]);
    const id = deviceId();
    await injectRegisterDevice(owner.cookie, id);
    expect((await unlock(owner.cookie, a.workspaceId, id)).statusCode).toBe(200);
    expect((await unlock(owner.cookie, b.workspaceId, id)).statusCode).toBe(200);

    const revoked = await app.inject({
      method: "POST",
      url: "/devices/revoke",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId: a.workspaceId, deviceId: id },
    });
    expect(revoked.statusCode).toBe(200);

    expect(
      (await unlock(owner.cookie, a.workspaceId, id)).statusCode,
      "workspace A, where the revoke happened, is denied",
    ).toBe(401);
    expect(
      (await unlock(owner.cookie, b.workspaceId, id)).statusCode,
      "F191 — workspace B must be untouched by workspace A's Owner",
    ).toBe(200);
  });

  it("the device's own user retiring it globally blocks unlock in every workspace", async () => {
    const owner = await createSignedInAccount();
    const a = await addWorkspace(owner.userId, `fdn63-r-a-${randomUUID()}`, true, [
      "owner",
    ]);
    const b = await addWorkspace(owner.userId, `fdn63-r-b-${randomUUID()}`, true, [
      "owner",
    ]);
    const id = deviceId();
    await injectRegisterDevice(owner.cookie, id);
    expect((await unlock(owner.cookie, a.workspaceId, id)).statusCode).toBe(200);
    expect((await unlock(owner.cookie, b.workspaceId, id)).statusCode).toBe(200);

    const retired = await app.inject({
      method: "POST",
      url: "/devices/retire",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { deviceId: id },
    });
    expect(retired.statusCode).toBe(200);

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row?.isRevoked).toBe(true);
    expect(row?.pushToken).toBeNull();

    expect((await unlock(owner.cookie, a.workspaceId, id)).statusCode).toBe(401);
    expect((await unlock(owner.cookie, b.workspaceId, id)).statusCode).toBe(401);

    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    const retirement = events.filter((e) => e.eventType === "retired-by-user");
    expect(retirement).toHaveLength(1);
    expect(retirement[0]?.workspaceId, "global retirement has no workspace scope").toBe(
      null,
    );
  });

  it("an Owner cannot retire another user's device through the global path", async () => {
    const owner = await createSignedInAccount();
    const colleague = await createSignedInAccount();
    const workspace = await addWorkspace(
      owner.userId,
      `fdn63-cross-${randomUUID()}`,
      true,
      ["owner"],
    );
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: workspace.workspaceId,
      userId: colleague.userId,
      role: "team-member",
      createdAt: new Date(),
      status: "active",
      projectionState: "confirmed",
    });
    const id = deviceId();
    await injectRegisterDevice(colleague.cookie, id);

    const attempt = await app.inject({
      method: "POST",
      url: "/devices/retire",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { deviceId: id },
    });
    expect(attempt.statusCode, "retirement is the device owner's authority alone").toBe(
      401,
    );

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row?.isRevoked).toBe(false);
  });

  it("revokeWorkspaceAdmission stays workspace-scoped and logs revoked-membership", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId, membershipId } = await addWorkspace(
      userId,
      `fdn63s3-cascade-${randomUUID()}`,
    );
    const other = await addWorkspace(userId, `fdn63s3-cascade-b-${randomUUID()}`);
    const id = deviceId();
    await injectRegisterDevice(cookie, id);
    expect((await unlock(cookie, workspaceId, id)).statusCode).toBe(200);
    expect((await unlock(cookie, other.workspaceId, id)).statusCode).toBe(200);

    await revokeWorkspaceAdmission(membershipId, randomUUID());

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(
      row?.isRevoked,
      "F191 — an offboarding from one workspace must not retire the device globally",
    ).toBe(false);
    expect(
      (await unlock(cookie, other.workspaceId, id)).statusCode,
      "and the other workspace must remain unlockable",
    ).toBe(200);

    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    const membershipEvents = events.filter((e) => e.eventType === "revoked-membership");
    expect(membershipEvents).toHaveLength(1);
    expect(membershipEvents[0]?.workspaceId).toBe(workspaceId);
  });

  it("suspendUserAndRevokeSessions revokes every workspace's secret and audits each device", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const a = await addWorkspace(userId, `fdn63s3-susp-a-${randomUUID()}`);
    const b = await addWorkspace(userId, `fdn63s3-susp-b-${randomUUID()}`);
    const id = deviceId();
    await injectRegisterDevice(cookie, id);
    expect((await unlock(cookie, a.workspaceId, id)).statusCode).toBe(200);
    expect((await unlock(cookie, b.workspaceId, id)).statusCode).toBe(200);

    await suspendUserAndRevokeSessions(userId);

    // Suspension revokes the device in every workspace the person belongs to, so
    // it does not need — and per F191 does not take — the global `is_revoked`
    // flag, which means one thing only: the owner retired it.
    const revocations = await db
      .select()
      .from(deviceWorkspaceRevocation)
      .where(sql`${deviceWorkspaceRevocation.deviceId} = ${id}`);
    expect(revocations.map((r) => r.workspaceId).sort()).toEqual(
      [a.workspaceId, b.workspaceId].sort(),
    );
    expect(revocations.every((r) => r.reason === "user-suspended")).toBe(true);
    expect((await probe(cookie, a.workspaceId, id)).statusCode).toBe(401);

    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row?.isRevoked).toBe(false);

    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    expect(events.filter((e) => e.eventType === "revoked-membership")).toHaveLength(1);
  });
});

/**
 * FDN-63 Stage 5 — lost/stale devices at the identity and trust layer.
 * Staleness is derived at read, never stored; re-approval reverses exactly
 * one revocation reason and nothing else.
 */
describe("FDN-63 — stale devices and re-approval", () => {
  const deviceId = () => `fdn63s5-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  async function ownerWorkspaceWithDevice() {
    const owner = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      owner.userId,
      `fdn63s5-${randomUUID()}`,
      true,
      ["owner"],
    );
    const id = deviceId();
    await injectRegisterDevice(owner.cookie, id);
    const unlocked = await probe(owner.cookie, workspaceId, id);
    expect(unlocked.statusCode).toBe(200);
    return { owner, workspaceId, id };
  }

  async function listDevices(cookie: string, workspaceId: string) {
    const response = await app.inject({
      method: "POST",
      url: "/devices/list",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId },
    });
    expect(response.statusCode).toBe(200);
    return json(response).devices as {
      deviceId: string;
      isStale: boolean;
      revokedInWorkspace: boolean;
      retiredByOwner: boolean;
      pushToken?: unknown;
    }[];
  }

  async function revoke(
    cookie: string,
    workspaceId: string,
    id: string,
    reason?: "stale",
  ) {
    return app.inject({
      method: "POST",
      url: "/devices/revoke",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: id, ...(reason ? { reason } : {}) },
    });
  }

  async function reapprove(cookie: string, workspaceId: string, id: string) {
    return app.inject({
      method: "POST",
      url: "/devices/re-approve",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: id },
    });
  }

  it("derives staleness at read from last_active_at, and stores no staleness column", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();

    const fresh = await listDevices(owner.cookie, workspaceId);
    expect(fresh[0]?.isStale).toBe(false);

    // Age the only input staleness has. Nothing else is touched.
    await db
      .update(device)
      .set({ lastActiveAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(sql`${device.id} = ${id}`);

    const stale = await listDevices(owner.cookie, workspaceId);
    expect(stale[0]?.isStale, "staleness follows last_active_at alone").toBe(true);
    // The proof it is derived rather than stored: the row is otherwise untouched.
    const [row] = await db
      .select()
      .from(device)
      .where(sql`${device.id} = ${id}`);
    expect(row?.isRevoked).toBe(false);
  });

  it("never returns a device's push token to a devices listing", async () => {
    const owner = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      owner.userId,
      `fdn63s5-push-${randomUUID()}`,
      true,
      ["owner"],
    );
    const id = deviceId();
    await app.inject({
      method: "POST",
      url: "/devices/register",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { deviceId: id, deviceName: "D", platform: "ios", pushToken: "secret" },
    });
    await probe(owner.cookie, workspaceId, id);

    const devices = await listDevices(owner.cookie, workspaceId);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.pushToken).toBeUndefined();
  });

  it("a staleness revocation is reversible by an Owner, and restores unlock", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();

    expect((await revoke(owner.cookie, workspaceId, id, "stale")).statusCode).toBe(200);
    const events = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    expect(events.some((e) => e.eventType === "stale-flagged")).toBe(true);

    const denied = await probe(owner.cookie, workspaceId, id);
    expect(denied.statusCode, "a stale-revoked device is denied while revoked").toBe(
      401,
    );

    expect((await reapprove(owner.cookie, workspaceId, id)).statusCode).toBe(200);
    const restored = await probe(owner.cookie, workspaceId, id);
    expect(restored.statusCode, "re-approval restores unlock in that workspace").toBe(
      200,
    );

    const after = await db
      .select()
      .from(deviceTrustEvent)
      .where(sql`${deviceTrustEvent.deviceId} = ${id}`);
    const reapprovals = after.filter((e) => e.eventType === "re-approved");
    expect(reapprovals).toHaveLength(1);
    expect(reapprovals[0]?.actorUserId).toBe(owner.userId);
  });

  /** The paired counterweight — the reason the audit log is the gate. */
  it("a deliberate revocation is NOT reversible", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();
    expect((await revoke(owner.cookie, workspaceId, id)).statusCode).toBe(200);

    const attempt = await reapprove(owner.cookie, workspaceId, id);
    expect(attempt.statusCode, "revoked-explicit is irreversible").toBe(409);

    const denied = await probe(owner.cookie, workspaceId, id);
    expect(denied.statusCode).toBe(401);
  });

  it("a later deliberate revocation supersedes an earlier stale flag", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();
    expect((await revoke(owner.cookie, workspaceId, id, "stale")).statusCode).toBe(200);
    expect((await reapprove(owner.cookie, workspaceId, id)).statusCode).toBe(200);
    expect((await revoke(owner.cookie, workspaceId, id)).statusCode).toBe(200);

    expect(
      (await reapprove(owner.cookie, workspaceId, id)).statusCode,
      "the most recent event decides, not the presence of an old stale flag",
    ).toBe(409);
  });

  it("an Owner cannot re-approve a device its own user retired globally", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();
    expect((await revoke(owner.cookie, workspaceId, id, "stale")).statusCode).toBe(200);

    // The device's own user retires it — which here is the same person, but
    // through the other authorized path.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/devices/retire",
          headers: { origin: ORIGIN, cookie: owner.cookie },
          payload: { deviceId: id },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (await reapprove(owner.cookie, workspaceId, id)).statusCode,
      "an Owner has no authority to undo the device owner's global retirement",
    ).toBe(409);
  });

  it("a non-Owner cannot re-approve", async () => {
    const { owner, workspaceId, id } = await ownerWorkspaceWithDevice();
    expect((await revoke(owner.cookie, workspaceId, id, "stale")).statusCode).toBe(200);

    const colleague = await createSignedInAccount();
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: workspaceId,
      userId: colleague.userId,
      role: "team-member",
      createdAt: new Date(),
      status: "active",
      projectionState: "confirmed",
    });

    expect((await reapprove(colleague.cookie, workspaceId, id)).statusCode).toBe(401);
  });
});

async function post(cookie: string | undefined, url: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    payload: payload as object,
  });
}

/** A person admitted to a workspace directly, as an invited member would be. */
async function admit(
  workspaceId: string,
  roles: ("owner" | "hr-admin" | "finance-admin" | "team-member")[],
) {
  await db.execute(sql`delete from rate_limit`);
  const person = await createSignedInAccount();
  const membershipId = randomUUID();
  await admitWorkspaceMember({
    workspaceId,
    membershipId,
    userId: person.userId,
    roles,
    actorUserId: person.userId,
  });
  return { ...person, membershipId };
}

describe("Stage 7 — workspace creation is one server transaction (the dual write is gone)", () => {
  it("creates the workspace, its founding Owner and the graph records, confirmed at once, with no grant and no device", async () => {
    const owner = await createSignedInAccount();
    const response = await post(owner.cookie, "/workspace/create", {
      workspaceName: "Acme Advisory",
    });
    expect(response.statusCode, response.body).toBe(200);
    const created = json(response) as { workspaceId: string; membershipId: string };
    expect(Object.keys(created).sort()).toEqual(["membershipId", "workspaceId"]);

    const [row] = await db
      .select({ status: member.status, projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${created.membershipId}`);
    expect(row).toEqual({ status: "active", projectionState: "confirmed" });
    const [currentSession] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(sql`${session.userId} = ${owner.userId}`);
    expect(currentSession?.activeOrganizationId).toBe(created.workspaceId);
    await expect(
      requireCurrentWorkspaceSession(headers(owner.cookie), created.workspaceId),
    ).resolves.toMatchObject({ workspaceId: created.workspaceId, roles: ["owner"] });

    // Eight founding graph records include the default Entity and its calendar.
    const nodes = await db.execute(
      sql`select node_type from graph_nodes where workspace_id = ${created.workspaceId} order by node_type`,
    );
    expect(
      (nodes as unknown as { node_type: string }[]).map((n) => n.node_type),
    ).toEqual(["Entity", "User", "WorkingCalendar", "Workspace", "WorkspaceMembership"]);
    const entities = await db.execute(
      sql`select lifecycle_status, record->>'name' as name, record->>'jurisdiction' as jurisdiction,
        record->>'default_currency' as currency
        from graph_nodes where workspace_id = ${created.workspaceId} and node_type = 'Entity'`,
    );
    expect(entities).toEqual([
      {
        lifecycle_status: "Active",
        name: "Acme Advisory",
        jurisdiction: "Global",
        currency: "USD",
      },
    ]);
    const audience = await db.execute(
      sql`select count(*)::int as n from sync_node_audience where workspace_id = ${created.workspaceId} and user_id = ${owner.userId}`,
    );
    expect((audience as unknown as { n: number }[])[0]!.n).toBeGreaterThan(0);
  });

  it("keeps the first active organization when the same person creates a second workspace", async () => {
    const owner = await createSignedInAccount();
    const first = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "First Firm" }),
    ) as { workspaceId: string };
    const second = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "Second Firm" }),
    ) as { workspaceId: string };
    expect(second.workspaceId).not.toBe(first.workspaceId);
    const [currentSession] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(sql`${session.userId} = ${owner.userId}`);
    expect(currentSession?.activeOrganizationId).toBe(first.workspaceId);
  });

  it("lists only the caller's active confirmed memberships without a workspace claim", async () => {
    const owner = await createSignedInAccount();
    const active = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "Active Firm" }),
    ) as { workspaceId: string };
    const pending = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "Pending Firm" }),
    ) as { workspaceId: string };
    const revoked = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "Revoked Firm" }),
    ) as { workspaceId: string };
    const suspended = json(
      await post(owner.cookie, "/workspace/create", {
        workspaceName: "Suspended Firm",
      }),
    ) as { workspaceId: string };
    await db
      .update(member)
      .set({ status: "pending", projectionState: "pending" })
      .where(sql`${member.organizationId} = ${pending.workspaceId}`);
    await db
      .update(member)
      .set({ status: "revoked", projectionState: "confirmed" })
      .where(sql`${member.organizationId} = ${revoked.workspaceId}`);
    await db
      .update(organization)
      .set({ status: "suspended" })
      .where(sql`${organization.id} = ${suspended.workspaceId}`);
    const stranger = await createSignedInAccount();
    await post(stranger.cookie, "/workspace/create", { workspaceName: "Other Firm" });

    const response = await post(owner.cookie, "/workspace/list-active-memberships", {});
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      { workspaceId: active.workspaceId, workspaceName: "Active Firm" },
    ]);
    const anonymous = await post(undefined, "/workspace/list-active-memberships", {});
    expect(anonymous.statusCode).toBe(401);
  });

  it("activates a sole confirmed membership for every null session after a later sign-in", async () => {
    const owner = await createSignedInAccount();
    const created = json(
      await post(owner.cookie, "/workspace/create", { workspaceName: "Only Firm" }),
    ) as { workspaceId: string };
    const laterSignIn = await signIn(owner.email);
    expect(laterSignIn.statusCode).toBe(200);
    await db
      .update(session)
      .set({ activeOrganizationId: null })
      .where(sql`${session.userId} = ${owner.userId}`);

    const response = await post(
      cookieHeader(laterSignIn),
      "/workspace/activate-sole-membership",
      {},
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(json(response)).toEqual({ workspaceId: created.workspaceId });
    const sessions = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(sql`${session.userId} = ${owner.userId}`);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(
      sessions.every((row) => row.activeOrganizationId === created.workspaceId),
    ).toBe(true);

    const repeated = await post(
      cookieHeader(laterSignIn),
      "/workspace/activate-sole-membership",
      {},
    );
    expect(json(repeated)).toEqual({ workspaceId: null });
    expect(
      (
        await db
          .select({ activeOrganizationId: session.activeOrganizationId })
          .from(session)
          .where(sql`${session.userId} = ${owner.userId}`)
      ).every((row) => row.activeOrganizationId === created.workspaceId),
    ).toBe(true);
  });

  it("does not activate with zero or multiple active memberships", async () => {
    const noWorkspace = await createSignedInAccount();
    const none = await post(
      noWorkspace.cookie,
      "/workspace/activate-sole-membership",
      {},
    );
    expect(none.statusCode).toBe(200);
    expect(json(none)).toEqual({ workspaceId: null });
    const [emptySession] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(sql`${session.userId} = ${noWorkspace.userId}`);
    expect(emptySession?.activeOrganizationId).toBeNull();

    const owner = await createSignedInAccount();
    await post(owner.cookie, "/workspace/create", { workspaceName: "First Firm" });
    await post(owner.cookie, "/workspace/create", { workspaceName: "Second Firm" });
    await db
      .update(session)
      .set({ activeOrganizationId: null })
      .where(sql`${session.userId} = ${owner.userId}`);
    const many = await post(owner.cookie, "/workspace/activate-sole-membership", {});
    expect(many.statusCode).toBe(200);
    expect(json(many)).toEqual({ workspaceId: null });
    const [unselected] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(sql`${session.userId} = ${owner.userId}`);
    expect(unselected?.activeOrganizationId).toBeNull();
    expect(
      (await post(undefined, "/workspace/activate-sole-membership", {})).statusCode,
    ).toBe(401);
  });

  it("refuses an unauthenticated caller and a malformed name", async () => {
    expect(
      (await post(undefined, "/workspace/create", { workspaceName: "X" })).statusCode,
    ).toBe(401);
    const owner = await createSignedInAccount();
    expect(
      (await post(owner.cookie, "/workspace/create", { workspaceName: "  " }))
        .statusCode,
    ).toBe(400);
  });

  it("the device-side grant, unlock, role-refresh and sync-ticket routes no longer exist", async () => {
    const owner = await createSignedInAccount();
    for (const url of [
      "/device-store/unlock",
      "/device-store/roles",
      "/device-store/revoke",
      "/sync/ticket",
      "/workspace/consume-projection-grant",
      "/workspace/consume-transition-grant",
      "/workspace/confirm-projection",
      "/workspace/transition-grant",
      "/workspace/confirm-revocation-projection",
      "/workspace/confirm-role-change",
    ]) {
      expect((await post(owner.cookie, url, {})).statusCode, url).toBe(404);
    }
  });
});

describe("Stage 7 — removal and role change are one server transaction", () => {
  async function ownerWorkspace() {
    const owner = await createSignedInAccount();
    const created = json(
      await post(owner.cookie, "/workspace/create", {
        workspaceName: `Firm ${randomUUID()}`,
      }),
    ) as { workspaceId: string; membershipId: string };
    return { owner, ...created };
  }

  it("revoke-member is Owner-gated, an Owner cannot revoke their own membership, and one call finishes the removal", async () => {
    const {
      owner,
      workspaceId,
      membershipId: ownerMembership,
    } = await ownerWorkspace();
    const colleague = await admit(workspaceId, ["team-member"]);
    const deviceId = `stage7-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");
    await injectRegisterDevice(colleague.cookie, deviceId);
    expect((await probe(colleague.cookie, workspaceId, deviceId)).statusCode).toBe(200);

    expect(
      (
        await post(colleague.cookie, "/workspace/revoke-member", {
          workspaceId,
          membershipId: colleague.membershipId,
        })
      ).statusCode,
      "a non-Owner is denied",
    ).toBe(401);
    expect(
      (
        await post(owner.cookie, "/workspace/revoke-member", {
          workspaceId,
          membershipId: ownerMembership,
        })
      ).statusCode,
      "an Owner cannot revoke their own membership",
    ).toBe(401);

    const removed = await post(owner.cookie, "/workspace/revoke-member", {
      workspaceId,
      membershipId: colleague.membershipId,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const [row] = await db
      .select({ status: member.status, projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${colleague.membershipId}`);
    expect(row).toEqual({ status: "revoked", projectionState: "confirmed" });
    const revocations = await db
      .select()
      .from(deviceWorkspaceRevocation)
      .where(sql`${deviceWorkspaceRevocation.deviceId} = ${deviceId}`);
    expect(revocations).toMatchObject([
      { workspaceId, reason: "membership-revoked", revokedBy: owner.userId },
    ]);
    expect((await probe(colleague.cookie, workspaceId, deviceId)).statusCode).toBe(401);
  });

  it("change-role widens and narrows immediately, reports the direction, and caps Owners", async () => {
    const { owner, workspaceId } = await ownerWorkspace();
    const colleague = await admit(workspaceId, ["team-member"]);
    const rolesOf = async () =>
      (await requireCurrentWorkspaceSession(headers(colleague.cookie), workspaceId))
        .roles;

    const widen = await post(owner.cookie, "/workspace/change-role", {
      workspaceId,
      membershipId: colleague.membershipId,
      roles: ["team-member", "hr-admin"],
    });
    expect(widen.statusCode, widen.body).toBe(200);
    expect(json(widen)).toMatchObject({
      direction: "widen",
      after: ["team-member", "hr-admin"],
    });
    expect([...(await rolesOf())].sort()).toEqual(["hr-admin", "team-member"]);

    const narrow = await post(owner.cookie, "/workspace/change-role", {
      workspaceId,
      membershipId: colleague.membershipId,
      roles: ["team-member"],
    });
    expect(json(narrow)).toMatchObject({ direction: "narrow" });
    expect(await rolesOf()).toEqual(["team-member"]);

    expect(
      (
        await post(colleague.cookie, "/workspace/change-role", {
          workspaceId,
          membershipId: colleague.membershipId,
          roles: ["owner"],
        })
      ).statusCode,
      "a non-Owner cannot change roles",
    ).toBe(401);
    for (let i = 0; i < 2; i += 1) await admit(workspaceId, ["owner"]);
    const fourth = await admit(workspaceId, ["team-member"]);
    expect(
      (
        await post(owner.cookie, "/workspace/change-role", {
          workspaceId,
          membershipId: fourth.membershipId,
          roles: ["owner"],
        })
      ).statusCode,
      "the Owner cap holds",
    ).toBe(401);
  });

  it("roleChangeDirection classifies widen, narrow and a mixed swap (mixed is narrow — fail-closed)", () => {
    expect(roleChangeDirection(["team-member"], ["team-member", "hr-admin"])).toBe(
      "widen",
    );
    expect(roleChangeDirection(["team-member", "hr-admin"], ["team-member"])).toBe(
      "narrow",
    );
    expect(roleChangeDirection(["team-member"], ["hr-admin"])).toBe("narrow");
  });
});
