import {
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * F151 (FDN-63) — the enumerable revocation signal.
 *
 * F148 fixed the session layer: a server error must not lock the device,
 * only an explicit denial may. This closes the analogous gap one layer up,
 * at the orchestration layer FDN-87's `eraseLocalStore` was deliberately
 * left unwired to — an erase is irreversible from the device's side
 * (`VPS-F001`'s own words about the Devices-table Revoke action), so the
 * signal that triggers it must be at least as hard to reach by accident as
 * F148 made a lock.
 *
 * Two, and only two, positive events may trigger an erase, each its own
 * classified value rather than a shared "revoked" bit:
 *
 *   `device-revoked`     — an explicit, single-device Revoke action
 *                           (`VPS-F001`'s Devices table), Owner-gated.
 *                           Scope: this device only.
 *   `membership-revoked` — a workspace membership revocation or account
 *                           offboarding (A003-T16). Scope: every device
 *                           this user has in this workspace.
 *
 * Everything else — session expiry, a transient server failure, a device
 * that was never registered, an unclassified denial — must produce neither
 * value, exactly as F148 already proved for locking.
 *
 * Written in pairs throughout, the same discipline F148's near-miss
 * demanded: every test that an event DOES erase is matched by one proving
 * a similar-looking event does NOT. Real stack: real Postgres, real
 * Chromium, the real `/device-store/roles` and `/device-store/revoke`
 * endpoints, real `SealedStore` behind real online unlocks. Per F122,
 * `resetRateLimits` runs in `beforeAll`.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple device revocation signal 151!";

const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

interface MutationOutcomeShape {
  status?: string;
  thrown?: string;
}

interface SignalDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  refreshRole(): Promise<string[]>;
  query(graphQuery: unknown): Promise<{ node?: unknown }>;
  mutate(base64Snapshots: readonly string[]): Promise<MutationOutcomeShape>;
  poisoning: {
    employeeId: string;
    buildClean(workspaceId: string): string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: SignalDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-f151-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Device Revocation Signal Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  const cookies = await page.context().cookies(apiOrigin);
  return { email, userId: user.id, cookies };
}

async function createOwnerWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Device Signal Co', ${`f151-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function openWorkspace(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

async function tryInitialize(page: Page): Promise<{ opened: boolean; error?: string }> {
  return page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      await api.initialize();
      return { opened: true };
    } catch (error: unknown) {
      return {
        opened: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function seedDurably(
  page: Page,
  workspaceId: string,
): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    const outcome = await api.mutate([api.poisoning.buildClean(id)]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return outcome.status;
  }, workspaceId);
}

async function employeeVisible(
  page: Page,
  nodeId: string,
): Promise<{ present?: boolean; thrown?: string }> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      const result = (await api.query({
        kind: "node-get",
        nodeId: id,
        nodeType: "Employee",
        includeSoftDeleted: false,
      })) as { node?: unknown };
      return { present: result.node !== null && result.node !== undefined };
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  }, nodeId);
}

/** The device_unlock_secret rows an unlock creates, in creation order. */
async function unlockedDeviceIds(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
): Promise<string[]> {
  const rows = await sql<{ deviceId: string }[]>`select "device_id" as "deviceId"
    from "device_unlock_secret" where "workspace_id" = ${workspaceId}
    order by "created_at" asc`;
  return rows.map((row) => row.deviceId);
}

async function membershipStatus(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await sql<{ status: string }[]>`select "status" from "member"
    where "organization_id" = ${workspaceId} and "user_id" = ${userId}`;
  return row?.status;
}

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("F151 — the enumerable revocation signal", () => {
  /**
   * The flagship case `VPS-F001` names: an Owner revokes ONE device, and it
   * alone is affected. Device A and device B are two genuinely separate
   * browser contexts — separate IndexedDB, separate generated deviceId —
   * sharing the same account, exactly as two of a person's real devices
   * would. The Owner (this account, on device A) revokes device B through
   * the real `/device-store/revoke` endpoint.
   */
  test("an explicit single-device revocation erases only that device's workspace, classified device-revoked", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      const workspaceId = await createOwnerWorkspace(sql, sharedAccount.userId);

      contextA = await browser.newContext({ ignoreHTTPSErrors: true });
      const pageA = await contextA.newPage();
      await contextA.addCookies(sharedAccount.cookies);
      await openWorkspace(pageA, workspaceId);
      expect((await tryInitialize(pageA)).opened).toBe(true);
      expect(await seedDurably(pageA, workspaceId)).toBe("applied");

      contextB = await browser.newContext({ ignoreHTTPSErrors: true });
      const pageB = await contextB.newPage();
      await contextB.addCookies(sharedAccount.cookies);
      await openWorkspace(pageB, workspaceId);
      expect((await tryInitialize(pageB)).opened).toBe(true);
      expect(await seedDurably(pageB, workspaceId)).toBe("applied");

      const deviceIds = await unlockedDeviceIds(sql, workspaceId);
      expect(
        deviceIds.length,
        `both devices must have registered their own unlock secret: ${JSON.stringify(deviceIds)}`,
      ).toBe(2);
      const [deviceA, deviceB] = deviceIds;

      // The Owner, on device A, revokes device B — through the real
      // endpoint, using device A's own session cookies.
      const revokeResponse = await contextA.request.post(
        `${apiOrigin}/device-store/revoke`,
        { data: { workspaceId, deviceId: deviceB } },
      );
      expect(revokeResponse.status(), "the revoke call must succeed").toBe(200);

      // Device B learns of it on its own next refresh.
      const observedB = await pageB.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshError: string | undefined;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { refreshError, locked: (await api.getStatus()).locked };
      });
      console.log(`F151/single-device: B observed ${JSON.stringify(observedB)}`);
      expect(observedB.locked, "the revoked device must lock").toBe(true);
      expect(
        observedB.refreshError,
        `must be classified device-revoked: ${JSON.stringify(observedB)}`,
      ).toContain("device-revoked");
      expect(
        observedB.refreshError,
        `and never the broader membership-revoked — the membership is fine: ${JSON.stringify(observedB)}`,
      ).not.toContain("membership-revoked");

      // Device B can never re-unlock, by design — this is F106's own
      // property (a device that fails the cold-restart checkpoint cannot
      // reopen encrypted local data), and it is why the erase's disk-level
      // effect cannot be independently re-observed from outside the
      // browser for THIS specific case: IndexedDB is browser-local, and
      // the only way to read it back is through a valid unlock, which a
      // revoked device secret can never produce again. `SealedStore.erase`
      // itself — that it genuinely removes the IndexedDB payload — is
      // already proven independently by FDN-87's own dedicated suite; what
      // this test proves is the WIRING (the right signal reaches the right
      // call), not the erase mechanism's own correctness a second time.
      //
      // So the assertion here is the one that IS observable, and is itself
      // a real security property: a revoked device's own attempt to reopen
      // the workspace it was just erased from must fail, not succeed.
      await openWorkspace(pageB, workspaceId).catch(() => undefined);
      const stillLocked = await pageB
        .getByTestId("locked-shell")
        .isVisible()
        .catch(() => false);
      const unlockedVisible = await pageB
        .getByTestId("graph-persistence-unlocked")
        .isVisible()
        .catch(() => false);
      console.log(
        `F151/single-device: B reopen attempt — locked shell visible=${stillLocked}, unlocked visible=${unlockedVisible}`,
      );
      expect(
        unlockedVisible,
        "a revoked device must never successfully reopen the workspace it was revoked from",
      ).toBe(false);

      // Device A — the counterweight. Untouched: refreshes cleanly, keeps
      // its content, and the membership itself was never revoked.
      const observedA = await pageA.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshError: string | undefined;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { refreshError, locked: (await api.getStatus()).locked };
      });
      console.log(`F151/single-device: A observed ${JSON.stringify(observedA)}`);
      expect(
        observedA.refreshError,
        `revoking B must not affect A's own device secret: ${JSON.stringify(observedA)}`,
      ).toBeUndefined();
      expect(observedA.locked, "A must remain unlocked").toBe(false);
      const contentA = await employeeVisible(pageA, SEED_EMPLOYEE);
      expect(
        contentA.present,
        `F151 — revoking one device must not erase another device's content: ${JSON.stringify(contentA)}`,
      ).toBe(true);
      expect(
        await membershipStatus(sql, workspaceId, sharedAccount.userId),
        "the membership itself must still be active — only device B was revoked",
      ).toBe("active");
      expect(deviceA).toBeTruthy(); // deviceA captured for readability of the destructure above
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  /**
   * The counterweight to the flagship case: a non-Owner may not revoke
   * ANYONE's device, including their own — the endpoint is Owner-gated,
   * deliberately narrower than VPS-F001's eventual full Devices-table
   * feature (self-revocation by any role is not built here; see FDN-63's
   * scope note).
   */
  test("a non-Owner's revoke attempt is denied and revokes nothing", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let ownerContext: BrowserContext | undefined;
    let memberContext: BrowserContext | undefined;
    try {
      const ownerEmail = `browser-f151-owner-${crypto.randomUUID()}@example.com`;
      const memberEmail = `browser-f151-member-${crypto.randomUUID()}@example.com`;
      const ownerId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const workspaceId = crypto.randomUUID();

      ownerContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`${webOrigin}/sign-up`);
      await ownerPage.getByLabel("Name").fill("F151 Owner");
      await ownerPage.getByLabel("Work email").fill(ownerEmail);
      await ownerPage.getByLabel("Password").fill(password);
      await ownerPage
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(
        ownerPage.getByRole("heading", { name: "Account ready" }),
      ).toBeVisible();

      memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const memberPage = await memberContext.newPage();
      await memberPage.goto(`${webOrigin}/sign-up`);
      await memberPage.getByLabel("Name").fill("F151 Team Member");
      await memberPage.getByLabel("Work email").fill(memberEmail);
      await memberPage.getByLabel("Password").fill(password);
      await memberPage
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(
        memberPage.getByRole("heading", { name: "Account ready" }),
      ).toBeVisible();

      const [ownerRow] = await sql<
        { id: string }[]
      >`select "id" from "user" where "email" = ${ownerEmail}`;
      const [memberRow] = await sql<
        { id: string }[]
      >`select "id" from "user" where "email" = ${memberEmail}`;
      if (!ownerRow || !memberRow) throw new Error("accounts were not created");

      await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
        values (${workspaceId}, 'F151 Non-Owner Co', ${`f151-nonowner-${workspaceId}`}, now(), 'active')`;
      await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
        values (${ownerId}, ${workspaceId}, ${ownerRow.id}, 'owner', now(), 'active', 'confirmed')`;
      await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
        values (${memberId}, ${workspaceId}, ${memberRow.id}, 'team-member', now(), 'active', 'confirmed')`;

      await openWorkspace(memberPage, workspaceId);
      expect((await tryInitialize(memberPage)).opened).toBe(true);

      const [deviceId] = await unlockedDeviceIds(sql, workspaceId);
      expect(deviceId, "the team member's device must have registered").toBeTruthy();

      // The team member attempts to revoke their OWN device — still denied,
      // because self-revocation-by-non-Owner is not built (deliberate scope
      // boundary, not an oversight).
      const revokeResponse = await memberContext.request.post(
        `${apiOrigin}/device-store/revoke`,
        { data: { workspaceId, deviceId } },
      );
      expect(
        revokeResponse.status(),
        "a non-Owner's revoke attempt must be denied",
      ).toBe(401);

      const [secret] = await sql<
        { revokedAt: Date | null }[]
      >`select "revoked_at" as "revokedAt" from "device_unlock_secret"
        where "workspace_id" = ${workspaceId} and "device_id" = ${deviceId}`;
      expect(
        secret?.revokedAt,
        "the device must genuinely remain unrevoked in the database",
      ).toBeNull();
    } finally {
      await ownerContext?.close();
      await memberContext?.close();
      await sql.end();
    }
  });

  /**
   * The discriminator this whole finding exists for: neither a transient
   * server failure nor an ambiguous denial may produce EITHER classified
   * value. Reused technique from S4's own suite — a 503 injected on the
   * checkpoint — proven here specifically against the two new codes, not
   * just against the old generic lock/no-lock question S4 already covers.
   */
  test("a transient server failure produces neither device-revoked nor membership-revoked", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createOwnerWorkspace(sql, sharedAccount.userId);

      await openWorkspace(page, workspaceId);
      expect((await tryInitialize(page)).opened).toBe(true);

      await context.route("**/device-store/roles", async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Service Unavailable" }),
        });
      });

      const observed = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshError: string | undefined;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { refreshError, locked: (await api.getStatus()).locked };
      });

      console.log(`F151/discriminator-503: ${JSON.stringify(observed)}`);
      expect(observed.locked, "a 503 must not lock (F148)").toBe(false);
      expect(
        observed.refreshError,
        `must not be classified device-revoked: ${JSON.stringify(observed)}`,
      ).not.toContain("device-revoked");
      expect(
        observed.refreshError,
        `must not be classified membership-revoked: ${JSON.stringify(observed)}`,
      ).not.toContain("membership-revoked");
    } finally {
      await context?.unroute("**/device-store/roles").catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The priority rule, checked directly rather than assumed: when a
   * membership revocation ALSO cascades to revoking every device's unlock
   * secret (`revokeWorkspaceAdmission`'s own transaction), the broader,
   * more informative reason must win. A caller told `device-revoked` for
   * what was actually a full membership removal would under-report the
   * scope of what just happened to their account.
   */
  test("a cascading membership revocation reports membership-revoked, not device-revoked", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createOwnerWorkspace(sql, sharedAccount.userId);

      await openWorkspace(page, workspaceId);
      expect((await tryInitialize(page)).opened).toBe(true);

      // The real membership-revocation path, which cascades to
      // device_unlock_secret.revokedAt for every device this user has in
      // this workspace, per requireCurrentWorkspaceSession's neighbor
      // revokeWorkspaceAdmission.
      await sql`update "member" set "status" = 'revoked'
        where "organization_id" = ${workspaceId} and "user_id" = ${sharedAccount.userId}`;
      await sql`update "device_unlock_secret" set "revoked_at" = now()
        where "workspace_id" = ${workspaceId} and "user_id" = ${sharedAccount.userId}`;

      const observed = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshError: string | undefined;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { refreshError, locked: (await api.getStatus()).locked };
      });

      console.log(`F151/cascade-priority: ${JSON.stringify(observed)}`);
      expect(observed.locked).toBe(true);
      expect(
        observed.refreshError,
        `both facts are true, but membership-revoked is the broader, correct report: ${JSON.stringify(observed)}`,
      ).toContain("membership-revoked");
      expect(
        observed.refreshError,
        `never the narrower device-revoked when membership itself was revoked: ${JSON.stringify(observed)}`,
      ).not.toContain("device-revoked");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * Idempotency: a second Revoke click must not error. `VPS-F001` calls
   * revocation destructive and irreversible — a confirmation modal is the
   * safeguard, not a brittle "already revoked" failure on the second try.
   */
  test("revoking an already-revoked device succeeds idempotently", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createOwnerWorkspace(sql, sharedAccount.userId);

      await openWorkspace(page, workspaceId);
      expect((await tryInitialize(page)).opened).toBe(true);
      const [deviceId] = await unlockedDeviceIds(sql, workspaceId);

      const first = await context.request.post(`${apiOrigin}/device-store/revoke`, {
        data: { workspaceId, deviceId },
      });
      const second = await context.request.post(`${apiOrigin}/device-store/revoke`, {
        data: { workspaceId, deviceId },
      });
      expect(first.status(), "the first revoke must succeed").toBe(200);
      expect(second.status(), "the second must ALSO succeed, not error").toBe(200);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
  /**
   * A second discriminator, closing a gap mutation testing found: a
   * PENDING, not-yet-confirmed membership already fails
   * `requireCurrentWorkspaceSession` for reasons unrelated to revocation —
   * the person was invited but never finished admission. The classifier
   * must not fold "not active" and "revoked" together; only a genuinely
   * `'revoked'` status may produce `membership-revoked`. A broader
   * `!== 'active'` check would have reported this pending, harmless case
   * as a revocation, escaping every other test in this file because none
   * of them construct a pending membership.
   */
  test("a pending, unconfirmed membership is denied but never classified as membership-revoked", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      // F122: this file's own beforeAll plus the non-Owner test already
      // account for three sign-ups, exhausting Better Auth's 3-per-60s
      // budget before this test's own sign-up runs.
      await resetRateLimits(sql);
      const email = `browser-f151-pending-${crypto.randomUUID()}@example.com`;
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(`${webOrigin}/sign-up`);
      await page.getByLabel("Name").fill("F151 Pending Member");
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();

      const [userRow] = await sql<
        { id: string }[]
      >`select "id" from "user" where "email" = ${email}`;
      if (!userRow) throw new Error("account was not created");

      // A membership that exists but was never confirmed — an invitation
      // still awaiting acceptance, not a revocation of anything.
      const workspaceId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
        values (${workspaceId}, 'F151 Pending Co', ${`f151-pending-${workspaceId}`}, now(), 'active')`;
      await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
        values (${membershipId}, ${workspaceId}, ${userRow.id}, 'team-member', now(), 'pending', 'pending')`;

      // Directly exercise the role-refresh checkpoint — a pending member
      // was never admitted, so there is nothing to unlock or open first.
      const response = await context.request.post(`${apiOrigin}/device-store/roles`, {
        data: { workspaceId },
      });
      const body = (await response.json()) as { revocation?: { kind?: string } };
      console.log(
        `F151/pending-membership: status=${response.status()} body=${JSON.stringify(body)}`,
      );

      expect(response.status(), "a pending membership must still be denied").toBe(401);
      expect(
        body.revocation?.kind,
        `a pending membership must never be classified as a revocation: ${JSON.stringify(body)}`,
      ).toBeUndefined();
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
