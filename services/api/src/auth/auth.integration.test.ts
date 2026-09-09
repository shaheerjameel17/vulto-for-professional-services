import { createHash, randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, closeDatabase } from "../db.js";
import { buildServer } from "../server.js";
import {
  account,
  device,
  deviceTrustEvent,
  deviceUnlockSecret,
  member,
  organization,
  session,
  syncTicket,
  user,
  workspaceProjectionGrant,
} from "./schema.js";
import {
  consumeMembershipTransitionGrant,
  consumeWorkspaceProjectionGrant,
  PROJECTION_GRANT_PREFIX,
  membershipInEdgeId,
  membershipOfEdgeId,
  roleChangeDirection,
} from "./workspace-projection.js";
import { SYNC_TICKET_PREFIX, SYNC_TICKET_TTL_SECONDS } from "./sync-ticket.js";
import {
  confirmWorkspaceAdmission,
  confirmWorkspaceRevocationProjection,
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

    await revokeWorkspaceAdmission(workspaceA.membershipId);
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
    expect(revoked).toEqual({
      status: "revoked",
      projectionState: "revocation-pending",
    });
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
 * F148 (S4). This route's answer is a device-facing SECURITY DECISION: a 401
 * here locks the caller's sealed local store, discarding anything still
 * inside its durability window (F144). So the route must never report a
 * failure OF ITS OWN as a statement about the caller's authorization.
 *
 * It used to. Any unexpected error — a database outage, a driver fault, a bug
 * — was logged and answered `401`, which every polling device read as
 * "revoked." One infrastructure blip locked every device in the workspace out
 * of its own local data, with no automatic recovery.
 *
 * The browser suite for F148 cannot cover this half: it intercepts the
 * response in the page, so the server is never reached. This is the only
 * place the server's own classification is exercised.
 */
describe("F148 — the role-refresh checkpoint separates its failures from its denials", () => {
  it("answers a healthy request with the caller's current roles", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(userId, `f148-ok-${randomUUID()}`);

    const response = await app.inject({
      method: "POST",
      url: "/device-store/roles",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId },
    });

    expect(response.statusCode).toBe(200);
    expect(json(response).roles).toEqual(["team-member"]);
  });

  it("answers an internal failure with 503, never with 401", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(userId, `f148-fail-${randomUUID()}`);

    // A genuine infrastructure failure rather than a simulated one: the
    // admission query cannot run, so the route's own error path is what
    // answers. Renamed rather than dropped, and restored in `finally`, so a
    // failure here cannot leave the test database broken for later tests.
    await db.execute(
      sql.raw('ALTER TABLE "member" RENAME COLUMN "status" TO "status_f148"'),
    );
    let response;
    try {
      response = await app.inject({
        method: "POST",
        url: "/device-store/roles",
        headers: { origin: ORIGIN, cookie },
        payload: { workspaceId },
      });
    } finally {
      await db.execute(
        sql.raw('ALTER TABLE "member" RENAME COLUMN "status_f148" TO "status"'),
      );
    }

    // 401 is the assertion that matters. It is what the device reads as a
    // revocation, and it is what this route used to send here.
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).toBe(503);
  });

  it("still answers a real revocation with 401", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId, membershipId } = await addWorkspace(
      userId,
      `f148-revoked-${randomUUID()}`,
    );
    await revokeWorkspaceAdmission(membershipId);

    const response = await app.inject({
      method: "POST",
      url: "/device-store/roles",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId },
    });

    // The counterweight to the test above: separating failures from denials
    // must not weaken the denial itself.
    expect(response.statusCode).toBe(401);
  });
});

/**
 * F151. `device-revocation-signal.spec.ts`'s cascading-priority browser test
 * hand-constructs the "membership revoked, and every device secret went
 * with it" state with two raw SQL updates — deliberately, since the
 * Playwright suite has no HTTP endpoint that calls `revokeWorkspaceAdmission`
 * in production yet (membership removal is unbuilt feature work). That
 * proves the CLASSIFIER's priority logic against a state matching what the
 * cascade produces; it does not exercise the cascade itself.
 *
 * This closes that gap directly: `revokeWorkspaceAdmission` is called for
 * real, in the same process, on a real registered device — proving the
 * ACTUAL transaction (not a hand-built imitation of it) produces the
 * classification F151 relies on.
 */
describe("F151 — the real revocation cascade classifies as membership-revoked", () => {
  it("a real revokeWorkspaceAdmission cascades to the device secret, and the checkpoint reports membership-revoked", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId, membershipId } = await addWorkspace(
      userId,
      `f151-cascade-${randomUUID()}`,
    );
    const deviceId = `f151-cascade-device-${randomUUID()}`.replace(
      /[^A-Za-z0-9_-]/g,
      "",
    );

    await injectRegisterDevice(cookie, deviceId);
    const unlockResponse = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId },
    });
    expect(unlockResponse.statusCode, "the device must unlock successfully").toBe(200);

    // The real function, not a hand-simulated cascade.
    await revokeWorkspaceAdmission(membershipId);

    // The cascade's own effect, checked directly: this device's secret was
    // revoked as a SIDE EFFECT of the membership revocation, not because
    // anything targeted this device specifically.
    const [secret] = await db
      .select({ revokedAt: deviceUnlockSecret.revokedAt })
      .from(deviceUnlockSecret)
      .where(
        sql`${deviceUnlockSecret.workspaceId} = ${workspaceId} and ${deviceUnlockSecret.deviceId} = ${deviceId}`,
      );
    expect(
      secret?.revokedAt,
      "revokeWorkspaceAdmission's own transaction must have revoked this device's secret",
    ).not.toBeNull();

    // The checkpoint's classification, against that REAL state.
    const rolesResponse = await app.inject({
      method: "POST",
      url: "/device-store/roles",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId },
    });
    expect(rolesResponse.statusCode).toBe(401);
    const body = JSON.parse(rolesResponse.body) as { revocation?: { kind?: string } };
    expect(
      body.revocation?.kind,
      `must be classified membership-revoked against the real cascade: ${rolesResponse.body}`,
    ).toBe("membership-revoked");
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
      const unlock = await app.inject({
        method: "POST",
        url: "/device-store/unlock",
        headers: { origin: ORIGIN, cookie },
        payload: { workspaceId: workspace.workspaceId, deviceId: id },
      });
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

  async function unlock(cookie: string, workspaceId: string, id: string) {
    return app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: id },
    });
  }

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

    // The device identity is revoked; the per-workspace secret is left intact.
    await db
      .update(device)
      .set({ isRevoked: true })
      .where(sql`${device.id} = ${id}`);
    const [secret] = await db
      .select({ revokedAt: deviceUnlockSecret.revokedAt })
      .from(deviceUnlockSecret)
      .where(sql`${deviceUnlockSecret.deviceId} = ${id}`);
    expect(secret?.revokedAt).toBeNull();

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
      url: "/device-store/revoke",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/device-store/revoke",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
    expect(second.statusCode).toBe(200);

    // F191. The workspace secret is revoked; the GLOBAL identity row is not.
    const [secret] = await db
      .select({ revokedAt: deviceUnlockSecret.revokedAt })
      .from(deviceUnlockSecret)
      .where(sql`${deviceUnlockSecret.deviceId} = ${id}`);
    expect(secret?.revokedAt).not.toBeNull();

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
      url: "/device-store/revoke",
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

    await revokeWorkspaceAdmission(membershipId);

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

    // Suspension already blocks unlock everywhere by revoking every secret,
    // so it does not need — and per F191 does not take — the global
    // `is_revoked` flag, which means one thing only: the owner retired it.
    const secrets = await db
      .select({ revokedAt: deviceUnlockSecret.revokedAt })
      .from(deviceUnlockSecret)
      .where(sql`${deviceUnlockSecret.deviceId} = ${id}`);
    expect(secrets).toHaveLength(2);
    expect(secrets.every((s) => s.revokedAt !== null)).toBe(true);

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
    const unlocked = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
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
      url: "/device-store/revoke",
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
    await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });

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

    const denied = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
    expect(denied.statusCode, "a stale-revoked device is denied while revoked").toBe(
      401,
    );

    expect((await reapprove(owner.cookie, workspaceId, id)).statusCode).toBe(200);
    const restored = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
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

    const denied = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie: owner.cookie },
      payload: { workspaceId, deviceId: id },
    });
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

describe("FDN-51 Stage 4a — POST /sync/ticket", () => {
  const deviceId = () =>
    `sync-ticket-device-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  async function registerDevice(cookie: string, workspaceId: string, device: string) {
    await injectRegisterDevice(cookie, device);
    const response = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: device },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  it("mints a prefixed ticket, stores only its hash, and never returns a session token", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      userId,
      `sync-ticket-ok-${randomUUID()}`,
    );
    const device = deviceId();
    await registerDevice(cookie, workspaceId, device);

    const response = await app.inject({
      method: "POST",
      url: "/sync/ticket",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: device },
    });
    expect(response.statusCode, response.body).toBe(200);
    const grant = json(response) as {
      ticket: string;
      expiresAt: string;
      ttlSeconds: number;
    };

    expect(grant.ticket.startsWith(SYNC_TICKET_PREFIX)).toBe(true);
    expect(grant.ttlSeconds).toBe(SYNC_TICKET_TTL_SECONDS);
    expect(sensitiveKeys(grant)).toEqual([]);
    expect(response.headers["cache-control"]).toBe("no-store");

    const rows = await db
      .select({
        tokenHash: syncTicket.tokenHash,
        deviceId: syncTicket.deviceId,
        userId: syncTicket.userId,
        workspaceId: syncTicket.workspaceId,
      })
      .from(syncTicket)
      .where(sql`${syncTicket.workspaceId} = ${workspaceId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(
      createHash("sha256").update(grant.ticket, "utf8").digest("hex"),
    );
    // The raw ticket is never stored.
    expect(rows[0]!.tokenHash).not.toContain(grant.ticket);
    expect(rows[0]!.deviceId).toBe(device);
    expect(rows[0]!.userId).toBe(userId);

    const expiresInMs = new Date(grant.expiresAt).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan((SYNC_TICKET_TTL_SECONDS - 60) * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(SYNC_TICKET_TTL_SECONDS * 1000);
  });

  it("replaces the device's previous ticket rather than accumulating them", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      userId,
      `sync-ticket-rotate-${randomUUID()}`,
    );
    const device = deviceId();
    await registerDevice(cookie, workspaceId, device);

    const mint = () =>
      app.inject({
        method: "POST",
        url: "/sync/ticket",
        headers: { origin: ORIGIN, cookie },
        payload: { workspaceId, deviceId: device },
      });
    const first = json(await mint()) as { ticket: string };
    const second = json(await mint()) as { ticket: string };
    expect(first.ticket).not.toBe(second.ticket);

    const rows = await db
      .select({ tokenHash: syncTicket.tokenHash })
      .from(syncTicket)
      .where(sql`${syncTicket.deviceId} = ${device}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(
      createHash("sha256").update(second.ticket, "utf8").digest("hex"),
    );
  });

  it("denies a device with no unlock secret", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      userId,
      `sync-ticket-nodev-${randomUUID()}`,
    );

    const response = await app.inject({
      method: "POST",
      url: "/sync/ticket",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: deviceId() },
    });
    expect(response.statusCode).toBe(401);
    expect(sensitiveKeys(json(response))).toEqual([]);
  });

  it("denies a revoked device", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      userId,
      `sync-ticket-revoked-${randomUUID()}`,
    );
    const device = deviceId();
    await registerDevice(cookie, workspaceId, device);

    await db
      .update(deviceUnlockSecret)
      .set({ revokedAt: new Date() })
      .where(
        sql`${deviceUnlockSecret.workspaceId} = ${workspaceId} and ${deviceUnlockSecret.deviceId} = ${device}`,
      );

    const response = await app.inject({
      method: "POST",
      url: "/sync/ticket",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId: device },
    });
    expect(response.statusCode).toBe(401);
  });

  it("denies an unauthenticated caller", async () => {
    const { cookie, userId } = await createSignedInAccount();
    const { workspaceId } = await addWorkspace(
      userId,
      `sync-ticket-anon-${randomUUID()}`,
    );
    const device = deviceId();
    await registerDevice(cookie, workspaceId, device);

    const response = await app.inject({
      method: "POST",
      url: "/sync/ticket",
      headers: { origin: ORIGIN },
      payload: { workspaceId, deviceId: device },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("FDN-85 Stage 2 — the founding workspace-admission projection", () => {
  const deviceId = () => `fdn85-device-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  async function createWorkspace(cookie: string, device: string, name = "Northwind") {
    return app.inject({
      method: "POST",
      url: "/workspace/create",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceName: name, deviceId: device },
    });
  }

  it("records a pending owner admission and returns a single-use grant with the server half and deterministic edge ids", async () => {
    const { cookie } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);

    const response = await createWorkspace(cookie, device);
    expect(response.statusCode, response.body).toBe(200);
    const grant = json(response) as Record<string, unknown>;

    expect(String(grant.grant).startsWith(PROJECTION_GRANT_PREFIX)).toBe(true);
    expect(typeof grant.serverHalf).toBe("string");
    expect(grant.roles).toEqual(["owner"]);
    expect(grant.membershipOfEdgeId).toBe(
      membershipOfEdgeId(String(grant.membershipId)),
    );
    expect(grant.membershipInEdgeId).toBe(
      membershipInEdgeId(String(grant.membershipId)),
    );
    expect(sensitiveKeys(grant)).toEqual([]);
    expect(response.headers["cache-control"]).toBe("no-store");

    // The membership is pending/pending — not yet admitting.
    const [row] = await db
      .select({ status: member.status, projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${String(grant.membershipId)}`);
    expect(row).toMatchObject({ status: "pending", projectionState: "pending" });

    const [org] = await db
      .select({ status: organization.status })
      .from(organization)
      .where(sql`${organization.id} = ${String(grant.workspaceId)}`);
    expect(org?.status).toBe("active");

    // Only the grant's hash is stored, and it is unconsumed.
    const [stored] = await db
      .select({
        tokenHash: workspaceProjectionGrant.tokenHash,
        consumedAt: workspaceProjectionGrant.consumedAt,
      })
      .from(workspaceProjectionGrant)
      .where(
        sql`${workspaceProjectionGrant.membershipId} = ${String(grant.membershipId)}`,
      );
    expect(stored?.tokenHash).toBe(
      createHash("sha256").update(String(grant.grant), "utf8").digest("hex"),
    );
    expect(stored?.consumedAt).toBeNull();
  });

  it("requireCurrentWorkspaceSession refuses the pending membership until the projection is confirmed, then admits it", async () => {
    const { cookie } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);
    const grant = json(await createWorkspace(cookie, device)) as Record<
      string,
      unknown
    >;
    const workspaceId = String(grant.workspaceId);
    const membershipId = String(grant.membershipId);

    await expect(
      requireCurrentWorkspaceSession(headers(cookie), workspaceId),
    ).rejects.toBeInstanceOf(UnauthorizedWorkspaceSessionError);

    const confirmed = await app.inject({
      method: "POST",
      url: "/workspace/confirm-projection",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, membershipId },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const admitted = await requireCurrentWorkspaceSession(headers(cookie), workspaceId);
    expect(admitted.roles).toEqual(["owner"]);
    expect(admitted.membershipId).toBe(membershipId);
  });

  it("the projection grant is single-use — a second consume is denied", async () => {
    const { cookie } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);
    const grant = json(await createWorkspace(cookie, device)) as Record<
      string,
      unknown
    >;
    const bound = {
      workspaceId: String(grant.workspaceId),
      membershipId: String(grant.membershipId),
      deviceId: device,
    };

    const first = await consumeWorkspaceProjectionGrant(String(grant.grant), bound);
    expect(first.userId).toBeTruthy();
    expect(first.roles).toEqual(["owner"]);

    await expect(
      consumeWorkspaceProjectionGrant(String(grant.grant), bound),
    ).rejects.toThrow();
  });

  it("a grant bound to a different device cannot be consumed", async () => {
    const { cookie } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);
    const grant = json(await createWorkspace(cookie, device)) as Record<
      string,
      unknown
    >;

    await expect(
      consumeWorkspaceProjectionGrant(String(grant.grant), {
        workspaceId: String(grant.workspaceId),
        membershipId: String(grant.membershipId),
        deviceId: `${device}-other`,
      }),
    ).rejects.toThrow();
  });

  it("a membership revoked between mint and confirm cannot be projected — confirm and consume both fail closed", async () => {
    const { cookie } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);
    const grant = json(await createWorkspace(cookie, device)) as Record<
      string,
      unknown
    >;
    const workspaceId = String(grant.workspaceId);
    const membershipId = String(grant.membershipId);

    await revokeWorkspaceAdmission(membershipId);

    await expect(
      consumeWorkspaceProjectionGrant(String(grant.grant), {
        workspaceId,
        membershipId,
        deviceId: device,
      }),
    ).rejects.toThrow();

    const confirmed = await app.inject({
      method: "POST",
      url: "/workspace/confirm-projection",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, membershipId },
    });
    expect(confirmed.statusCode).toBe(401);
  });

  it("denies an unauthenticated workspace.create", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/create",
      headers: { origin: ORIGIN },
      payload: { workspaceName: "Nope", deviceId: deviceId() },
    });
    expect(response.statusCode).toBe(401);
  });

  it("denies workspace.create for a device with no registration row", async () => {
    const { cookie } = await createSignedInAccount();
    const response = await createWorkspace(cookie, deviceId());
    expect(response.statusCode).toBe(401);
  });
});

describe("FDN-85 Stage 3 — removal and role-change projection", () => {
  const deviceId = () =>
    `fdn85s3-device-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  /** A confirmed Owner of a fresh workspace, plus their device. */
  async function ownerWithWorkspace() {
    const { cookie, userId } = await createSignedInAccount();
    const device = deviceId();
    await injectRegisterDevice(cookie, device);
    const created = json(
      await app.inject({
        method: "POST",
        url: "/workspace/create",
        headers: { origin: ORIGIN, cookie },
        payload: { workspaceName: "Northwind", deviceId: device },
      }),
    ) as Record<string, unknown>;
    const workspaceId = String(created.workspaceId);
    const membershipId = String(created.membershipId);
    const confirm = await app.inject({
      method: "POST",
      url: "/workspace/confirm-projection",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, membershipId },
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
    return { cookie, userId, device, workspaceId, ownerMembershipId: membershipId };
  }

  /** A second, confirmed member of an EXISTING workspace (server-seeded —
   * FDN-86 owns the real invitation flow). */
  async function addConfirmedMember(workspaceId: string, roles: WorkspaceRoleName[]) {
    const { userId } = await createSignedInAccount();
    const membershipId = randomUUID();
    await db.insert(member).values({
      id: membershipId,
      organizationId: workspaceId,
      userId,
      role: roles.join(","),
      createdAt: new Date(),
      status: "pending",
      projectionState: "pending",
    });
    await confirmWorkspaceAdmission(membershipId);
    return { userId, membershipId };
  }

  type WorkspaceRoleName = "owner" | "hr-admin" | "finance-admin" | "team-member";

  async function post(
    cookie: string,
    url: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: "POST",
      url,
      headers: { origin: ORIGIN, cookie },
      payload,
    });
  }

  it("revoke-member: Owner-gated, denies centrally first, then a transition grant projects the revocation and confirms it", async () => {
    const owner = await ownerWithWorkspace();
    const { membershipId } = await addConfirmedMember(owner.workspaceId, [
      "team-member",
    ]);

    const revoked = await post(owner.cookie, "/workspace/revoke-member", {
      workspaceId: owner.workspaceId,
      membershipId,
    });
    expect(revoked.statusCode, revoked.body).toBe(200);

    // Central denial is immediate — the member row is revoked/revocation-pending.
    const [row] = await db
      .select({ status: member.status, projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${membershipId}`);
    expect(row).toMatchObject({
      status: "revoked",
      projectionState: "revocation-pending",
    });

    // A revocation transition grant is available for the Owner's device.
    const grant = json(
      await post(owner.cookie, "/workspace/transition-grant", {
        workspaceId: owner.workspaceId,
        membershipId,
        deviceId: owner.device,
        kind: "revocation",
      }),
    ) as Record<string, unknown>;
    expect(grant.kind).toBe("revocation");
    expect(String(grant.grant).startsWith(PROJECTION_GRANT_PREFIX)).toBe(true);

    const consumed = await consumeMembershipTransitionGrant(String(grant.grant), {
      workspaceId: owner.workspaceId,
      membershipId,
      deviceId: owner.device,
      kind: "revocation",
    });
    expect(consumed.kind).toBe("revocation");

    // ...then the history projection is confirmed.
    const confirmed = await post(
      owner.cookie,
      "/workspace/confirm-revocation-projection",
      {
        workspaceId: owner.workspaceId,
        membershipId,
      },
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const [after] = await db
      .select({ projectionState: member.projectionState })
      .from(member)
      .where(sql`${member.id} = ${membershipId}`);
    expect(after?.projectionState).toBe("confirmed");
  });

  it("revoke-member: a non-Owner is denied, and an Owner cannot revoke their own membership", async () => {
    const owner = await ownerWithWorkspace();
    const other = await addConfirmedMember(owner.workspaceId, ["hr-admin"]);
    // Sign the hr-admin in.
    const [u] = await db
      .select({ email: user.email })
      .from(user)
      .where(sql`${user.id} = ${other.userId}`);
    const hrCookie = cookieHeader(await signIn(u!.email!));

    const byNonOwner = await post(hrCookie, "/workspace/revoke-member", {
      workspaceId: owner.workspaceId,
      membershipId: owner.ownerMembershipId,
    });
    expect(byNonOwner.statusCode).toBe(401);

    const selfRevoke = await post(owner.cookie, "/workspace/revoke-member", {
      workspaceId: owner.workspaceId,
      membershipId: owner.ownerMembershipId,
    });
    expect(selfRevoke.statusCode).toBe(401);
  });

  it("role change — NARROW: member.role is updated centrally immediately, before any graph projection", async () => {
    const owner = await ownerWithWorkspace();
    const { membershipId } = await addConfirmedMember(owner.workspaceId, [
      "hr-admin",
      "finance-admin",
    ]);

    const result = json(
      await post(owner.cookie, "/workspace/change-role", {
        workspaceId: owner.workspaceId,
        membershipId,
        deviceId: owner.device,
        roles: ["hr-admin"],
      }),
    ) as Record<string, unknown>;
    expect(result.direction).toBe("narrow");

    // Central role already narrowed — the F127 poll will pick this up.
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(sql`${member.id} = ${membershipId}`);
    expect(row?.role).toBe("hr-admin");
  });

  it("role change — WIDEN: member.role is NOT updated until confirm-role-change, after the graph records it", async () => {
    const owner = await ownerWithWorkspace();
    const { membershipId } = await addConfirmedMember(owner.workspaceId, ["hr-admin"]);

    const result = json(
      await post(owner.cookie, "/workspace/change-role", {
        workspaceId: owner.workspaceId,
        membershipId,
        deviceId: owner.device,
        roles: ["hr-admin", "finance-admin"],
      }),
    ) as Record<string, unknown>;
    expect(result.direction).toBe("widen");

    // Central role unchanged so far — widen is graph-first.
    const [before] = await db
      .select({ role: member.role })
      .from(member)
      .where(sql`${member.id} = ${membershipId}`);
    expect(before?.role).toBe("hr-admin");

    const confirmed = await post(owner.cookie, "/workspace/confirm-role-change", {
      workspaceId: owner.workspaceId,
      membershipId,
      roles: ["hr-admin", "finance-admin"],
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const [after] = await db
      .select({ role: member.role })
      .from(member)
      .where(sql`${member.id} = ${membershipId}`);
    expect(after?.role?.split(",").sort()).toEqual(["finance-admin", "hr-admin"]);
  });

  it("stale-state CAS: a revocation transition grant cannot be consumed while the membership is still active/confirmed", async () => {
    const owner = await ownerWithWorkspace();
    const { membershipId } = await addConfirmedMember(owner.workspaceId, [
      "team-member",
    ]);

    // No revoke has happened — the membership is active/confirmed.
    const grant = await post(owner.cookie, "/workspace/transition-grant", {
      workspaceId: owner.workspaceId,
      membershipId,
      deviceId: owner.device,
      kind: "revocation",
    });
    expect(grant.statusCode).toBe(401);
  });

  it("stale-state CAS: confirm-revocation-projection fails once the membership is no longer revocation-pending", async () => {
    const owner = await ownerWithWorkspace();
    const { membershipId } = await addConfirmedMember(owner.workspaceId, [
      "team-member",
    ]);
    await revokeWorkspaceAdmission(membershipId);
    // First confirm succeeds.
    await confirmWorkspaceRevocationProjection(membershipId);
    // Second confirm — no longer revocation-pending.
    const again = await post(owner.cookie, "/workspace/confirm-revocation-projection", {
      workspaceId: owner.workspaceId,
      membershipId,
    });
    expect(again.statusCode).toBe(401);
  });

  it("roleChangeDirection classifies widen, narrow and a mixed swap (mixed is narrow — fail-closed)", () => {
    expect(roleChangeDirection(["hr-admin"], ["hr-admin", "finance-admin"])).toBe(
      "widen",
    );
    expect(roleChangeDirection(["hr-admin", "finance-admin"], ["hr-admin"])).toBe(
      "narrow",
    );
    expect(roleChangeDirection(["hr-admin"], ["finance-admin"])).toBe("narrow");
  });
});
