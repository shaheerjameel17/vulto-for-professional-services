import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, closeDatabase } from "../db.js";
import { buildServer } from "../server.js";
import { account, deviceUnlockSecret, member, session, user } from "./schema.js";
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

async function addWorkspace(userId: string, slug: string, confirmed = true) {
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  await createPendingWorkspaceAdmission({
    workspaceId,
    workspaceName: slug,
    workspaceSlug: slug,
    membershipId,
    userId,
    roles: ["team-member"],
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
      "passkey_registration_context", "passkey", "invitation", "member",
      "organization", "session", "account", "verification", "user",
      "rate_limit"
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
