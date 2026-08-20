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
 * S4 (FDN-54) — the offline→online transition, and what the device concludes
 * from the answer it gets when it reconnects.
 *
 * S4 was filed as a race: "on reconnect the ordering between 'pending flush
 * lands' and 'first poll returns a denial' is racy, and if the flush wins, a
 * revoked device persists writes authorized against arbitrarily stale roles."
 *
 * The first test below checks that premise directly, because a race needs
 * both sides to still be in flight and the flush is a purely local IndexedDB
 * write that needs no network at all.
 *
 * The rest of the file is what S4 turned into once the reconnect path was
 * actually driven: the device could not tell "the server says you are
 * revoked" from "the server had a problem," and treated both as revocation.
 *
 * **F148, closed by founder ruling and repository fix.** A server error must
 * not lock the device; only an explicit, unambiguous denial may. These tests
 * are the permanent proof of that, and they are written in pairs on purpose —
 * every test that proves a failure does NOT lock is matched by one proving a
 * real revocation still DOES. A fix to this defect that quietly stopped
 * revocation from working would satisfy half of this file and fail the
 * other half.
 *
 * Real stack throughout — real Postgres, real Chromium, real `SealedStore`
 * behind a real online unlock, the real `refresh-role` protocol message, and
 * a real membership that stays **valid in the database for every test in this
 * file**. Nothing here revokes anybody. That is the point: every lock this
 * file produces is one the server never asked for.
 *
 * Per F122, `resetRateLimits` runs in `beforeAll`.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple role refresh S4!";

const FLUSH_DEBOUNCE_MS = 250;
const VICTIM_EMPLOYEE_COUNT = 3;
const FIRST_VICTIM_EMPLOYEE = "88888888-8888-4888-8888-000000000000";
const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

interface MutationOutcomeShape {
  status?: string;
  reason?: string;
  thrown?: string;
}

interface RefreshDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  unlock(): Promise<{ unlocked: boolean; error?: string }>;
  query(graphQuery: unknown): Promise<{ node?: unknown }>;
  mutate(base64Snapshots: readonly string[]): Promise<MutationOutcomeShape>;
  refreshRole(): Promise<string[]>;
  poisoning: {
    employeeId: string;
    buildBulk(workspaceId: string, count: number): string;
    buildClean(workspaceId: string): string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: RefreshDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-s4-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Role Refresh Browser");
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
    values (${workspaceId}, 'Role Refresh Co', ${`s4-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

/** Confirms the membership is still valid, so a lock cannot be blamed on revocation. */
async function membershipIsActive(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ status: string }[]>`select "status" from "member"
    where "organization_id" = ${workspaceId} and "user_id" = ${userId}`;
  return rows[0]?.status === "active";
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
): Promise<MutationOutcomeShape | { thrown: string }> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      const value = await api.mutate([api.poisoning.buildClean(id)]);
      await new Promise((resolve) => setTimeout(resolve, 700));
      return value;
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
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

/**
 * Answers the role-refresh checkpoint with a transient server failure, for
 * the Worker's own fetch as well as the page's.
 *
 * 503 is chosen because it is unambiguous: it is the response a healthy,
 * correctly-configured deployment returns while a dependency is briefly
 * unavailable. It says nothing whatsoever about this device's authorization.
 * It is also not a hypothetical shape — `services/api/src/auth/http.ts`
 * answers ANY unexpected server-side error on this route by logging it and
 * replying `401`, so in production a database blip reaches the device as an
 * even stronger denial than this test injects.
 */
async function failRoleRefreshWith(
  context: BrowserContext,
  status: number,
): Promise<void> {
  await context.route("**/device-store/roles", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: "Service Unavailable" }),
    });
  });
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

test.describe("S4 — what a device concludes when it reconnects", () => {
  /**
   * S4's premise, checked before anything is built on it.
   *
   * The race S4 describes needs a flush still pending at the moment of
   * reconnect. But `#persist` writes to the sealed store, which is
   * IndexedDB — entirely local, no network. So the flush should complete
   * 250ms after the offline write, long before reconnect, and there should
   * be no pending flush for the first poll to race.
   */
  test("premise: an offline write flushes while still offline, so no flush is pending at reconnect", async ({
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
      const opened = await tryInitialize(page);
      expect(opened.opened, `a fresh workspace must initialize: ${opened.error}`).toBe(
        true,
      );

      // Cut the network, then write. The unlock already happened, so the
      // product is expected to keep working offline (F106).
      await context.setOffline(true);
      const offlineWrite = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          const value = await api.mutate([api.poisoning.buildBulk(id, 3)]);
          // Well past the 250ms debounce: if the flush needs the network,
          // it has had every chance and still cannot have run.
          await new Promise((resolve) => setTimeout(resolve, 900));
          return value;
        } catch (error: unknown) {
          return { thrown: error instanceof Error ? error.message : String(error) };
        }
      }, workspaceId);
      expect(
        offlineWrite.status,
        `an offline write must still apply: ${JSON.stringify(offlineWrite)}`,
      ).toBe("applied");

      await context.setOffline(false);

      // Reopen on a genuinely new Worker and read the durable snapshot.
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `the workspace must reopen after the offline write: ${reopened.error}`,
      ).toBe(true);

      const durable = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(`S4/premise offline write durable: ${JSON.stringify(durable)}`);
      expect(
        durable.present,
        `the offline write must already be durable, which means no flush was pending at reconnect: ${JSON.stringify(durable)}`,
      ).toBe(true);
    } finally {
      await context?.setOffline(false).catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  /**
   * F148's core property. The membership is valid throughout and is asserted
   * valid at the end — the server never denied anything, so nothing may lock.
   */
  test("a transient server failure does not lock the local store", async ({
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
      const opened = await tryInitialize(page);
      expect(opened.opened, `a fresh workspace must initialize: ${opened.error}`).toBe(
        true,
      );

      await failRoleRefreshWith(context, 503);

      const observed = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const lockedBefore = (await api.getStatus()).locked;
        let refreshError: string | null = null;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return {
          lockedBefore,
          refreshError,
          lockedAfter: (await api.getStatus()).locked,
        };
      });

      console.log(`S4/transient-503: ${JSON.stringify(observed)}`);
      expect(observed.lockedBefore, "the store must start unlocked").toBe(false);
      expect(
        observed.lockedAfter,
        `F148 — a 503 is not a revocation and must not lock the store: ${JSON.stringify(observed)}`,
      ).toBe(false);
      // And it is reported as what it is. Reporting a server outage as
      // "denied" is what told callers a revocation had happened when none
      // had, so the code carries the finding as much as the lock state does.
      expect(
        observed.refreshError,
        `a server failure must report unavailable, not denied: ${JSON.stringify(observed)}`,
      ).toContain("role-refresh-unavailable");

      // The control that makes this a finding rather than a coincidence:
      // nothing about this user's authorization changed.
      expect(
        await membershipIsActive(sql, workspaceId, sharedAccount.userId),
        "the membership must still be active — the server never revoked anything",
      ).toBe(true);
    } finally {
      await context?.unroute("**/device-store/roles").catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The consequence F148's fix removes. Before it, `lockSealedStore()` stopped
   * the poll timer AND nulled `#apiOrigin`, so a spurious denial switched off
   * the very mechanism that would notice the server had come back: the device
   * stayed locked for the whole session over a momentary 502.
   *
   * Now the outage is survived rather than recovered from — the device is
   * never locked in the first place, keeps serving its own local data
   * throughout, and picks the roles back up the moment the server can answer.
   */
  test("the device works through a server outage and picks up roles when it ends", async ({
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
      const opened = await tryInitialize(page);
      expect(opened.opened, `a fresh workspace must initialize: ${opened.error}`).toBe(
        true,
      );

      await failRoleRefreshWith(context, 503);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.refreshRole();
        } catch {
          /* the injected 503 */
        }
      });
      expect(
        await page.evaluate(
          async () =>
            (await window.__vultoGraphPersistenceDiagnostics!.getStatus()).locked,
        ),
        "the 503 must not have locked the store",
      ).toBe(false);

      // The outage ends. The server is healthy and the membership is valid.
      await context.unroute("**/device-store/roles");

      const recovery = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        // Well past one 15-second poll interval, so the unattended poll has
        // run against the healthy server at least once on its own.
        await new Promise((resolve) => setTimeout(resolve, 18_000));
        const lockedAfterWaiting = (await api.getStatus()).locked;
        let refreshError: string | null = null;
        let rolesAfterRecovery: string[] | null = null;
        try {
          rolesAfterRecovery = await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { lockedAfterWaiting, refreshError, rolesAfterRecovery };
      });

      console.log(`S4/survives-outage: ${JSON.stringify(recovery)}`);
      expect(
        recovery.lockedAfterWaiting,
        `the device must never have locked over a server outage: ${JSON.stringify(recovery)}`,
      ).toBe(false);
      // The outage is over and the checkpoint answers again — no Retry, no
      // reload, no re-unlock. The poll was never stopped, so nothing needs
      // restarting.
      expect(
        recovery.refreshError,
        `the refresh must succeed once the server recovers: ${JSON.stringify(recovery)}`,
      ).toBeNull();
      expect(
        recovery.rolesAfterRecovery,
        `and it must return this device's real roles: ${JSON.stringify(recovery)}`,
      ).toEqual(["owner"]);
      expect(
        await membershipIsActive(sql, workspaceId, sharedAccount.userId),
        "the membership must still be active throughout",
      ).toBe(true);
    } finally {
      await context?.unroute("**/device-store/roles").catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  /**
   * Where F148's fix directly reduces F144's severity, which is the reason the
   * founder ruled on this one first.
   *
   * F144's silent data loss is still open — a real revocation landing inside
   * the flush window still discards an acknowledged write. What made it
   * COMMON rather than rare was that any server hiccup triggered the same
   * lock. This test pins that door shut: the write survives a 503 landing in
   * exactly the window that loses it to a revocation.
   */
  test("an authorized write survives a server failure inside the flush window", async ({
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
      const opened = await tryInitialize(page);
      expect(opened.opened, `a fresh workspace must initialize: ${opened.error}`).toBe(
        true,
      );
      const seed = await seedDurably(page, workspaceId);
      expect(seed.status, `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      await failRoleRefreshWith(context, 503);

      const run = await page.evaluate(
        async ({ id, count }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          const openedAt = performance.now();
          const victim = await api.mutate([api.poisoning.buildBulk(id, count)]);
          try {
            await api.refreshRole();
          } catch {
            /* the injected 503 */
          }
          const lockLandedAfterMs = performance.now() - openedAt;
          const locked = (await api.getStatus()).locked;
          await new Promise((resolve) => setTimeout(resolve, 900));
          return { victim, lockLandedAfterMs, locked };
        },
        { id: workspaceId, count: VICTIM_EMPLOYEE_COUNT },
      );

      expect(
        run.victim.status,
        `the victim write must be authorized and applied: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(run.locked, "the injected 503 must not have locked the store").toBe(false);
      expect(
        run.lockLandedAfterMs,
        `the failure must land inside the ${FLUSH_DEBOUNCE_MS}ms flush window (took ${run.lockLandedAfterMs}ms)`,
      ).toBeLessThan(FLUSH_DEBOUNCE_MS);

      await context.unroute("**/device-store/roles");
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(reopened.opened, `the workspace must still open: ${reopened.error}`).toBe(
        true,
      );

      const seedSurvived = await employeeVisible(page, SEED_EMPLOYEE);
      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S4/hiccup-preserves-write: seed=${JSON.stringify(seedSurvived)} victim=${JSON.stringify(victimSurvived)}`,
      );
      expect(
        seedSurvived.present,
        `the pre-hiccup seed must be durable, or this run cannot isolate the window: ${JSON.stringify(seedSurvived)}`,
      ).toBe(true);
      expect(
        victimSurvived.present,
        `F148 — a server hiccup must not discard a fully authorized user's acknowledged write: ${JSON.stringify(victimSurvived)}`,
      ).toBe(true);
      expect(
        await membershipIsActive(sql, workspaceId, sharedAccount.userId),
        "the membership must still be active — nothing was ever revoked",
      ).toBe(true);
    } finally {
      await context?.unroute("**/device-store/roles").catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });
  /**
   * The counterweight, and the reason this file is written in pairs.
   *
   * Everything above proves a failure does NOT lock. On its own that is
   * satisfied just as well by a "fix" that never locks at all — which would
   * silently disable revocation, the single most important behavior on this
   * path. So this test performs a REAL revocation, through the real `member`
   * row, and requires the lock to still happen.
   *
   * It is the same assertion S1's suite depends on, kept here deliberately
   * rather than by reference: whoever next changes `fetchCurrentRoles`'s
   * classification should find both halves in the file they are editing
   * against.
   */
  test("a real revocation still locks the store, and is still reported as a denial", async ({
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
      const opened = await tryInitialize(page);
      expect(opened.opened, `a fresh workspace must initialize: ${opened.error}`).toBe(
        true,
      );

      // The real thing: no interception anywhere in this test.
      await sql`update "member" set "status" = 'revoked'
        where "organization_id" = ${workspaceId} and "user_id" = ${sharedAccount.userId}`;

      const observed = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshError: string | null = null;
        try {
          await api.refreshRole();
        } catch (error: unknown) {
          refreshError = error instanceof Error ? error.message : String(error);
        }
        return { refreshError, locked: (await api.getStatus()).locked };
      });

      console.log(`S4/real-revocation: ${JSON.stringify(observed)}`);
      expect(
        observed.locked,
        `a real revocation must still lock the store — a fix that stopped this would be far worse than the defect: ${JSON.stringify(observed)}`,
      ).toBe(true);
      expect(
        observed.refreshError,
        `and must still be reported as a denial, not as unavailable: ${JSON.stringify(observed)}`,
      ).toContain("role-refresh-denied");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
