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
  session,
  syncTicket,
  user,
} from "./schema.js";
import { SYNC_TICKET_PREFIX, SYNC_TICKET_TTL_SECONDS } from "./sync-ticket.js";
import {
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

    const unlockResponse = await app.inject({
      method: "POST",
      url: "/device-store/unlock",
      headers: { origin: ORIGIN, cookie },
      payload: { workspaceId, deviceId },
    });
    expect(unlockResponse.statusCode, "the device must register successfully").toBe(
      200,
    );

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
  });
});

describe("FDN-51 Stage 4a — POST /sync/ticket", () => {
  const deviceId = () =>
    `sync-ticket-device-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, "");

  async function registerDevice(cookie: string, workspaceId: string, device: string) {
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
