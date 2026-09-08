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
 * S1 (FDN-54) — revocation landing inside the debounce window.
 *
 * The seam this crosses is four components wide and no stage-level suite can
 * see it, because each component behaves correctly in isolation:
 *
 *   F127's role poll        (FDN-53 stage 1) — locks the store on a denial
 *   `SealedStore`           (FDN-84)         — refuses every read/write once locked
 *   the debounced flush     (FDN-50 stage 2) — durability deferred 250ms
 *   `mutate`'s commit       (FDN-53 stage 2) — authorizes, merges, materializes
 *
 * `mutate` authorizes a batch against the roles this device currently holds,
 * merges it, materializes it, tells the caller `applied`, and schedules the
 * durable write for 250ms later. Inside that window the server revokes the
 * membership; the next role refresh is denied; `refreshRoleOnline` locks the
 * sealed store. The flush timer then fires into a locked store and throws
 * into `#pendingFlushError`, where nothing observes it.
 *
 * **F144 and F145, closed by founder ruling and repository fix.** This file
 * began as a reproduction and is now the permanent proof of the answers.
 *
 *   Q1. A write this device was authorized to make and was told was
 *       `applied` never reached disk. Ruling: **losing it is not correct.**
 *       The window is flushed while the device is still authorized, because
 *       at the instant before the lock those writes were legitimate — the
 *       same reasoning F139 already applied to a workspace switch.
 *   Q2. A revoked device kept a materialized plaintext index, and the Loro
 *       document behind it, resident in the Worker. Ruling: **it must not.**
 *       The plaintext is released once authority ends.
 *
 * The order is the whole ruling and each step is load-bearing: **flush while
 * still authorized, then lock, then purge.** Flushing after the lock is
 * impossible — the store refuses — and purging before the flush would
 * destroy the very writes step one exists to save.
 *
 * **Written in pairs, deliberately, the same way F148's suite is.** Every
 * test that the purge fires when authority ends is matched by one proving it
 * does NOT fire on an ordinary lock. F148 was caused by treating an ambiguous
 * event as a security event; a purge on every lock would be that same mistake
 * pointing the other way, and would cost a full re-materialization each time.
 *
 * Real stack throughout — real Postgres, real Chromium, real `SealedStore`
 * behind a real online unlock, real Loro and SQLite WASM, real revocation
 * through the real `member` row, and the real production
 * `mutate`/`refresh-role`/`query` protocol messages.
 *
 * F142's fix changed this terrain and the change is deliberately accounted
 * for: the zombie-Worker hang S1 was originally going to probe now fails
 * fast with a real error. Neither question above depends on that, and the
 * step timeout below stays so a regression to hanging is still named rather
 * than showing up as an opaque suite timeout.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple revocation debounce S1!";

/**
 * FDN-50 stage 2's `FLUSH_DEBOUNCE_MS`. Mirrored rather than imported: this
 * file asserts that the revocation genuinely landed inside the window, and a
 * constant that moved with the implementation would make that assertion
 * vacuous.
 */
const FLUSH_DEBOUNCE_MS = 250;

/**
 * Small on purpose. F138's proof needed 150 employees to make materialization
 * slow; S1 needs the opposite — the mutation must finish fast so the whole
 * remaining debounce window is available for the revocation to land in.
 */
const VICTIM_EMPLOYEE_COUNT = 3;

/** The first id `buildBulk` writes; the victim write's witness. */
const FIRST_VICTIM_EMPLOYEE = "88888888-8888-4888-8888-000000000000";

/** The id `buildClean` writes; the durable seed's witness. */
const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

const STEP_TIMEOUT_MS = 20_000;

/**
 * What `mutate` reports once the sealed store is locked and NOTHING was lost.
 *
 * Pinned as a literal, and paired with `DISCARDED_WRITES_CODE` below. F144
 * was that these two situations produced the byte-identical report, so a
 * caller could not tell that anything had been discarded. The pair is
 * asserted from both sides: a lock that lost nothing must still report this,
 * and a lock that lost writes must report the other. Collapsing them again
 * fails both tests.
 */
const LOSSLESS_LOCK_REPORT_MESSAGE =
  "runtime-failure: The sealed local store is locked";

/** F144. The code a caller switches on to learn that acknowledged writes are gone. */
const DISCARDED_WRITES_CODE = "local-writes-discarded";

interface StepOutcome {
  timedOut?: true;
  thrown?: string;
  value?: unknown;
}

interface MutationOutcomeShape {
  status?: string;
  reason?: string;
  thrown?: string;
}

interface RevocationRunResult {
  /** The authorized write whose durability the revocation interrupts. */
  victim: StepOutcome;
  /** The real `refresh-role` message, denied by the server post-revocation. */
  roleRefresh: StepOutcome;
  /** Milliseconds from the victim write returning to the store being locked. */
  lockLandedAfterMs: number;
  /** `get-sealed-store-status` once the refresh has been denied. */
  lockedAfterRefresh: boolean;
  /** A production query attempted while revoked. Q2's reachability question. */
  queryWhileLocked?: StepOutcome;
  /** A production mutation attempted while revoked, which is where the swallowed flush error surfaces. */
  mutateWhileLocked?: StepOutcome;
}

/** The subset of the diagnostics harness this proof drives. */
interface RevocationDiagnosticsApi {
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
    __vultoGraphPersistenceDiagnostics?: RevocationDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-s1-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Revocation Debounce Browser");
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
    values (${workspaceId}, 'Revocation Debounce Co', ${`s1-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

/**
 * The real revocation. `requireCurrentWorkspaceSession` admits only
 * `member.status = 'active'`, so this is exactly what an Owner removing
 * someone from the workspace produces — not a simulated denial, not a
 * stubbed endpoint.
 */
async function revokeMembership(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await sql`update "member" set "status" = 'revoked'
    where "organization_id" = ${workspaceId} and "user_id" = ${userId}`;
}

/** Confirms nothing revoked this membership, so a behavior cannot be blamed on revocation. */
async function membershipIsStillActive(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ status: string }[]>`select "status" from "member"
    where "organization_id" = ${workspaceId} and "user_id" = ${userId}`;
  return rows[0]?.status === "active";
}

/** Re-grants the membership, so a proof can read back what the device kept. */
async function restoreMembership(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await sql`update "member" set "status" = 'active'
    where "organization_id" = ${workspaceId} and "user_id" = ${userId}`;
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

/** Seeds one durable employee and waits out its own flush window. */
async function seedDurably(page: Page, workspaceId: string): Promise<StepOutcome> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      const value = await api.mutate([api.poisoning.buildClean(id)]);
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { value };
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  }, workspaceId);
}

/**
 * Drives the S1 race entirely inside the page, so the revocation lands in the
 * SAME 250ms window the victim write opened rather than in a later one.
 *
 * The membership is already revoked in Postgres before this runs. The device
 * does not know that yet — which is the whole point: `mutate` authorizes
 * against the roles it cached at unlock, exactly as a real device would in
 * the seconds between a revocation and its next poll.
 *
 * `probeWhileLocked` is opt-in because probing is destructive to the very
 * state Q2 needs to inspect: a query against a locked store throws, and the
 * throw is reported as a FATAL runtime failure, which terminates the Worker
 * and takes the in-memory plaintext with it.
 */
async function runRevocationRace(
  page: Page,
  workspaceId: string,
  options: {
    /** "none" observes nothing; "query-first" and "mutate-first" differ only in order. */
    probeWhileLocked: "none" | "query-first" | "mutate-first";
    /**
     * Milliseconds to wait after the victim write before letting the
     * revocation land. 0 puts the lock inside the flush window; anything
     * past `FLUSH_DEBOUNCE_MS` puts it after, which is the control.
     */
    delayBeforeRefreshMs: number;
  },
): Promise<RevocationRunResult> {
  return page.evaluate(
    async ({ id, count, probe, delayBeforeRefreshMs, stepTimeout }) => {
      const api = window.__vultoGraphPersistenceDiagnostics;
      if (!api) throw new Error("diagnostics API missing");

      async function step(run: () => Promise<unknown>): Promise<StepOutcome> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<StepOutcome>((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true }), stepTimeout);
        });
        try {
          return await Promise.race([
            run().then(
              (value): StepOutcome => ({ value }),
              (error: unknown): StepOutcome => ({
                thrown: error instanceof Error ? error.message : String(error),
              }),
            ),
            timeout,
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }

      // The authorized write. Returns `applied` — merged, materialized,
      // queryable — with its durable flush 250ms out.
      //
      // The clock starts BEFORE the call, not after it. `#scheduleFlush`
      // runs inside the Worker before the response is posted back, so the
      // 250ms window is already open by the time `mutate` resolves here.
      // Measuring from the resolution would overstate how much of the
      // window is left and could let a lock that actually LOST the race be
      // recorded as having landed inside it.
      const openedAt = performance.now();
      const victim = await step(() => api.mutate([api.poisoning.buildBulk(id, count)]));

      // The control lever. Waiting past the debounce window lets the flush
      // complete BEFORE the revocation lands, which is the same scenario in
      // every respect except the one under test.
      if (delayBeforeRefreshMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBeforeRefreshMs));
      }

      // The revocation arriving at this device. This is F127's real
      // `refresh-role` path, the same one the 15s poll drives; calling it
      // directly only removes the wait, it does not change the code path.
      const roleRefresh = await step(() => api.refreshRole());
      const lockLandedAfterMs = performance.now() - openedAt;
      const lockedAfterRefresh = (await api.getStatus()).locked;

      const result: RevocationRunResult = {
        victim,
        roleRefresh,
        lockLandedAfterMs,
        lockedAfterRefresh,
      };

      // Long enough for the debounce timer to fire into the now-locked store
      // and for its failure to be captured, unobserved, in #pendingFlushError.
      await new Promise((resolve) => setTimeout(resolve, 900));

      // Ordering matters and is the point of running both. The FIRST call
      // after the lock is the only one that can carry `#pendingFlushError`
      // to the caller — whichever it is, its failure is fatal, so the
      // Worker is terminated and the second call can only ever report that.
      const queryWhileLocked = (): Promise<StepOutcome> =>
        step(() =>
          api.query({
            kind: "node-get",
            nodeId: api.poisoning.employeeId,
            nodeType: "Employee",
            includeSoftDeleted: false,
          }),
        );
      const mutateWhileLocked = (): Promise<StepOutcome> =>
        step(() => api.mutate([api.poisoning.buildClean(id)]));

      if (probe === "query-first") {
        result.queryWhileLocked = await queryWhileLocked();
        result.mutateWhileLocked = await mutateWhileLocked();
      } else if (probe === "mutate-first") {
        result.mutateWhileLocked = await mutateWhileLocked();
        result.queryWhileLocked = await queryWhileLocked();
      }

      return result;
    },
    {
      id: workspaceId,
      count: VICTIM_EMPLOYEE_COUNT,
      probe: options.probeWhileLocked,
      delayBeforeRefreshMs: options.delayBeforeRefreshMs,
      stepTimeout: STEP_TIMEOUT_MS,
    },
  );
}

/** Asks the live index whether a given employee is visible. */
async function employeeVisible(page: Page, nodeId: string): Promise<StepOutcome> {
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
      return { value: { present: result.node !== null && result.node !== undefined } };
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  }, nodeId);
}

const status = (step: StepOutcome): string | undefined =>
  (step.value as MutationOutcomeShape | undefined)?.status;

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // F122: this file signs up real accounts against the real API.
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("S1 — revocation landing inside the debounce window", () => {
  /**
   * Q1, updated by F151. Originally: does the flushed write survive a real
   * revocation. F151 changed the true answer for a REAL membership
   * revocation specifically — it is no longer merely a lock, it is an
   * erase (F151's whole point), so a real revocation now destroys the
   * flushed write anyway, along with everything else in the workspace.
   * That is not a regression of F144's ruling; it is F151 correctly
   * escalating beyond it for the one event the specs name as destructive.
   *
   * This test now proves the FULL, honest consequence end to end: the
   * write was authorized and applied, the revocation was real, and the
   * reopened workspace is EMPTY afterward — not "missing one write," gone
   * entirely, because F151 erased it. The isolated F144 property — a flush
   * survives an authority-ending event PROVIDED that event does not also
   * erase — is proven separately below, using a denial the server does
   * NOT classify, which is the one remaining case where flush-without-
   * erase still applies.
   */
  test("Q1: a real membership revocation erases the whole workspace, including the write it just flushed", async ({
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
      expect(status(seed), `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      await revokeMembership(sql, workspaceId, sharedAccount.userId);
      const run = await runRevocationRace(page, workspaceId, {
        probeWhileLocked: "query-first",
        delayBeforeRefreshMs: 0,
      });

      // --- the scenario genuinely set itself up ---------------------------
      expect(
        status(run.victim),
        `the victim write must be AUTHORIZED and applied — S1 is about losing a legitimate write, not a refused one: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(
        run.roleRefresh.thrown,
        `the server must DENY the refresh after revocation: ${JSON.stringify(run.roleRefresh)}`,
      ).toBeDefined();
      expect(
        run.lockedAfterRefresh,
        "a denied role refresh must lock the sealed store",
      ).toBe(true);
      expect(
        run.lockLandedAfterMs,
        `the revocation must land INSIDE the ${FLUSH_DEBOUNCE_MS}ms flush window, or this run proves nothing (took ${run.lockLandedAfterMs}ms)`,
      ).toBeLessThan(FLUSH_DEBOUNCE_MS);

      // --- what the device did while revoked -----------------------------
      // F149: a call arriving after `#endLocalSession` purged the runtime is
      // no longer answered with a bare `not-initialized` — it carries the
      // classified revocation reason, so a shell can render the mid-session
      // locked transition rather than a never-initialized error.
      console.log(
        `S1/Q1 while revoked: query=${JSON.stringify(run.queryWhileLocked)} mutate=${JSON.stringify(run.mutateWhileLocked)}`,
      );
      expect(
        JSON.stringify(run.queryWhileLocked),
        "F149 — a query after a classified revocation reports membership-revoked, not bare not-initialized",
      ).toContain("membership-revoked");
      expect(
        JSON.stringify(run.mutateWhileLocked),
        "F149 — and so does a mutate; neither fatally terminates the Worker",
      ).toContain("membership-revoked");

      // --- what actually reached disk ------------------------------------
      await restoreMembership(sql, workspaceId, sharedAccount.userId);
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `the workspace must still open after a revoked interval: ${reopened.error}`,
      ).toBe(true);

      const seedSurvived = await employeeVisible(page, SEED_EMPLOYEE);
      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S1/Q1 durable state: seed=${JSON.stringify(seedSurvived)} victim=${JSON.stringify(victimSurvived)}`,
      );

      // F151. A real membership revocation erases the WHOLE workspace, not
      // just the write that was still in flight. The pre-revocation seed —
      // durable long before any of this started — is gone too.
      expect(
        (seedSurvived.value as { present?: boolean } | undefined)?.present,
        `F151 — a real revocation erases even content that was already durable: ${JSON.stringify(seedSurvived)}`,
      ).toBe(false);
      expect(
        (victimSurvived.value as { present?: boolean } | undefined)?.present,
        `F151 — and the write it had just flushed, for the same reason: ${JSON.stringify(victimSurvived)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The isolated F144 property, recovered from Q1's old framing now that a
   * real revocation erases rather than merely locking. F144's ruling still
   * holds exactly as stated for the case it actually describes: an
   * authority-ending denial the server does NOT classify as one of F151's
   * two named events. There, the correct behavior is still flush-then-lock,
   * no erase — proven here using a 401 with no `revocation` field, the same
   * technique S4's suite uses to inject an unclassified denial.
   */
  test("Q1b: an unclassified denial still flushes the pending write before locking, and does not erase", async ({
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

      // An unclassified denial: a 401 with no `revocation` field. Nothing
      // in this workspace's membership is touched — the classifier's own
      // independent query would find nothing to classify even if it ran.
      await context.route("**/device-store/roles", async (route) => {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unclassified denial for this test" }),
        });
      });

      // One atomic browser-side block, exactly like `runRevocationRace`
      // above: the clock starts before `mutate` is even called, because
      // `#scheduleFlush` runs inside the Worker before the response is
      // posted back — measuring from outside a single evaluate call would
      // add Playwright's own IPC round trips to the measured window and
      // could misreport whether the denial genuinely landed inside it.
      const run = await page.evaluate(
        async ({ id, count }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          const openedAt = performance.now();
          const victim = await api.mutate([api.poisoning.buildBulk(id, count)]);
          let refreshError: string | undefined;
          try {
            await api.refreshRole();
          } catch (error: unknown) {
            refreshError = error instanceof Error ? error.message : String(error);
          }
          const lockLandedAfterMs = performance.now() - openedAt;
          const locked = (await api.getStatus()).locked;
          return { victim, refreshError, lockLandedAfterMs, locked };
        },
        { id: workspaceId, count: VICTIM_EMPLOYEE_COUNT },
      );

      expect(
        run.victim.status,
        `the victim write must be authorized and applied: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(run.locked, "an unclassified denial must still lock").toBe(true);
      expect(
        run.lockLandedAfterMs,
        `the denial must land inside the ${FLUSH_DEBOUNCE_MS}ms window (took ${run.lockLandedAfterMs}ms)`,
      ).toBeLessThan(FLUSH_DEBOUNCE_MS);
      expect(
        run.refreshError,
        `an unclassified denial must report the plain lock code, never an erase code: ${run.refreshError}`,
      ).toContain("role-refresh-denied");

      await context.unroute("**/device-store/roles");
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `the workspace must still open — nothing was erased: ${reopened.error}`,
      ).toBe(true);
      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(`S1/Q1b durable state: ${JSON.stringify(victimSurvived)}`);
      expect(
        (victimSurvived.value as { present?: boolean } | undefined)?.present,
        `F144's original property, still true for an unclassified denial — the flush survives: ${JSON.stringify(victimSurvived)}`,
      ).toBe(true);
    } finally {
      await context?.unroute("**/device-store/roles").catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  /**
   * Q2. `lockSealedStore()` drops the AES key and the role set — the small
   * half — and used to leave a fully materialized plaintext index of the
   * whole workspace, and the Loro document behind it, resident in the Worker.
   * Now the purge releases both once authority ends.
   *
   * The instrument is the same one that originally exposed the retention,
   * reading the opposite result: re-unlock the SAME Worker and try to read.
   * Before the fix that returned the workspace's data. Now there is nothing
   * to read from — the runtime is back to its pre-`initialize()` state — and
   * the data is reachable only by opening the workspace again from disk,
   * which is what a device that legitimately regains access does.
   *
   * Deliberately does NOT query while locked and before the re-unlock: that
   * throw is fatal and terminates the Worker, which would free the heap as a
   * side effect and make the purge unfalsifiable.
   */
  test("Q2: a device whose authority ended keeps no queryable plaintext in memory", async ({
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
      expect(status(seed), `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      await revokeMembership(sql, workspaceId, sharedAccount.userId);
      const run = await runRevocationRace(page, workspaceId, {
        probeWhileLocked: "none",
        delayBeforeRefreshMs: 0,
      });

      expect(
        status(run.victim),
        `the victim write must be authorized and applied: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(
        run.lockedAfterRefresh,
        "a denied role refresh must lock the sealed store",
      ).toBe(true);
      expect(
        run.lockLandedAfterMs,
        `the revocation must land inside the ${FLUSH_DEBOUNCE_MS}ms flush window (took ${run.lockLandedAfterMs}ms)`,
      ).toBeLessThan(FLUSH_DEBOUNCE_MS);

      // The app shell's own answer to being revoked mid-session. The locked
      // gate reads the lock state once, on mount — recorded here because a
      // revoked device that still renders the unlocked shell is part of what
      // Q2 is asking about.
      const shellStillUnlocked = await page
        .getByTestId("graph-persistence-unlocked")
        .isVisible();
      console.log(
        `S1/Q2 shell still rendering unlocked after revocation: ${shellStillUnlocked}`,
      );

      // The instrument. Re-granting is how the plaintext is READ, not how it
      // is retained: the runtime held it throughout the revoked interval
      // either way, and this only asks whether it is still intact.
      await restoreMembership(sql, workspaceId, sharedAccount.userId);
      const reunlocked = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.unlock();
      });
      expect(
        reunlocked.unlocked,
        `the same Worker must re-unlock for this to observe anything: ${JSON.stringify(reunlocked)}`,
      ).toBe(true);

      const afterReunlock = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S1/Q2 in-memory state after re-unlock: ${JSON.stringify(afterReunlock)}`,
      );

      // The ruling. The index is opened `:memory:` and the only code that
      // reads the durable snapshot back is `initialize()`, which re-unlocking
      // does not call — so anything this query could have returned would have
      // come from plaintext the Worker was still holding. It returns nothing:
      // the document and index were released when authority ended.
      expect(
        (afterReunlock.value as { present?: boolean } | undefined)?.present,
        `F145 — no plaintext may remain queryable in the Worker after authority ends: ${JSON.stringify(afterReunlock)}`,
      ).toBeUndefined();
      // Asserted on the protocol CODE rather than the prose, per F144's own
      // lesson: a caller switches on the code, and a message can be reworded
      // without anything noticing.
      expect(
        afterReunlock.thrown,
        `and the runtime must report itself uninitialized rather than answering: ${JSON.stringify(afterReunlock)}`,
      ).toContain("not-initialized");

      // F151. Updated: for a REAL revocation specifically, the disk copy is
      // gone too — not merely the in-memory one. Before F151 this section
      // proved memory-purge and disk-survival as two separate facts; now a
      // real revocation erases both, and re-granting membership does not
      // bring the erased content back, because the ERASE (not a lock) is
      // what happened. Opening the workspace again reads an empty
      // workspace from disk, not the old content.
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `an erased workspace must still open, empty, not refuse: ${reopened.error}`,
      ).toBe(true);
      const fromDisk = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(`S1/Q2 read back from disk: ${JSON.stringify(fromDisk)}`);
      expect(
        (fromDisk.value as { present?: boolean } | undefined)?.present,
        `F151 — a real revocation erases disk content too, not only memory: ${JSON.stringify(fromDisk)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
  /**
   * The control. Identical in every respect except that the revocation is
   * allowed to land AFTER the flush window has closed.
   *
   * F151 changes what this control proves. It used to isolate the flush
   * window as the CAUSE of loss — revoke early, the write is lost; revoke
   * late, it survives. F151 makes that distinction stop mattering for a
   * real revocation: revocation now erases the whole workspace regardless
   * of when it lands relative to the window, because erasure is not a race
   * with the flush timer the way silent loss was. This control now proves
   * THAT — timing no longer matters, which is the stronger, intended
   * property, not a weaker one.
   */
  test("control: timing no longer matters — early or late, a real revocation erases either way", async ({
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
      expect(status(seed), `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      await revokeMembership(sql, workspaceId, sharedAccount.userId);
      const run = await runRevocationRace(page, workspaceId, {
        // Identical to Q1 in every respect but the delay — including the
        // probe, so timing really is the single variable between them.
        probeWhileLocked: "query-first",
        delayBeforeRefreshMs: 700,
      });

      expect(
        status(run.victim),
        `the victim write must be authorized and applied: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(
        run.lockedAfterRefresh,
        "a denied role refresh must lock the sealed store",
      ).toBe(true);
      expect(
        run.lockLandedAfterMs,
        `the control requires the lock to land OUTSIDE the ${FLUSH_DEBOUNCE_MS}ms window (took ${run.lockLandedAfterMs}ms)`,
      ).toBeGreaterThan(FLUSH_DEBOUNCE_MS);

      await restoreMembership(sql, workspaceId, sharedAccount.userId);
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(reopened.opened, `the workspace must still open: ${reopened.error}`).toBe(
        true,
      );

      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(`S1/control durable state: victim=${JSON.stringify(victimSurvived)}`);
      // F151. Was `.toBe(true)` — revoking late used to mean durable.
      // Revoking late now STILL erases, exactly like revoking early (Q1).
      // Timing stopped being the variable that decides the outcome.
      expect(
        (victimSurvived.value as { present?: boolean } | undefined)?.present,
        `F151 — a real revocation erases the workspace whether it lands inside or outside the flush window: ${JSON.stringify(victimSurvived)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The pair the founder's ruling turns on, and the reason this file is
   * written the way F148's is.
   *
   * Everything above proves the purge fires when authority ends. On its own
   * that is satisfied just as well by a purge that fires on EVERY lock —
   * which would be the F148 mistake pointing the other way: an ordinary,
   * recoverable event treated as a security event, at the cost of a full
   * re-materialization each time and, if it ever ran before the flush, the
   * writes F144 exists to save.
   *
   * So this performs an ordinary `lockSealedStore()` — the plain lock a
   * future idle-lock would use — and requires the in-memory state to still
   * be there afterwards.
   */
  test("paired: an ordinary lock does not purge, and the same Worker still serves after re-unlock", async ({
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
      expect(status(seed), `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      // An ordinary lock. No revocation anywhere — the membership stays
      // valid, and is asserted valid below.
      const locked = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.lock();
        return (await api.getStatus()).locked;
      });
      expect(locked, "the ordinary lock must have taken effect").toBe(true);

      const reunlocked = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.unlock();
      });
      expect(
        reunlocked.unlocked,
        `the same Worker must re-unlock: ${JSON.stringify(reunlocked)}`,
      ).toBe(true);

      // No re-initialize anywhere in this test. If the runtime had purged,
      // this query would report itself uninitialized exactly as Q2's does.
      const stillServed = await employeeVisible(page, SEED_EMPLOYEE);
      console.log(`S1/paired after ordinary lock: ${JSON.stringify(stillServed)}`);
      expect(
        (stillServed.value as { present?: boolean } | undefined)?.present,
        `an ordinary lock must NOT purge — a plain lock is recoverable and must not cost a re-materialization: ${JSON.stringify(stillServed)}`,
      ).toBe(true);
      expect(
        await membershipIsStillActive(sql, workspaceId, sharedAccount.userId),
        "nothing in this test revokes anything",
      ).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * F144's other half: whatever happens to the writes, a caller must be able
   * to TELL. Before the fix, a lock that silently discarded a durability
   * window and a lock that discarded nothing produced the byte-identical
   * report, so no caller could distinguish them.
   *
   * A discarded window is now reachable only by locking the store out from
   * under an already-scheduled flush — the ordinary `lock()` path, since the
   * revocation path flushes first precisely so this cannot happen there. That
   * makes it the right instrument for this test and nothing else: it produces
   * a genuinely lost window on demand.
   *
   * Asserted from both sides, because either alone would pass if the two were
   * collapsed back together.
   */
  test("reporting: a discarded durability window is distinguishable from an ordinary lock", async ({
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

      const reports = await page.evaluate(
        async ({ id, count }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");

          async function reportOf(run: () => Promise<unknown>): Promise<string> {
            try {
              const value = (await run()) as { thrown?: string };
              return value.thrown ?? JSON.stringify(value);
            } catch (error: unknown) {
              return error instanceof Error ? error.message : String(error);
            }
          }

          // (a) A lock with a durability window still open. The flush fires
          //     into a locked store and its writes are gone.
          await api.mutate([api.poisoning.buildBulk(id, count)]);
          await api.lock();
          await new Promise((resolve) => setTimeout(resolve, 900));
          const lossy = await reportOf(() =>
            api.mutate([api.poisoning.buildClean(id)]),
          );

          // (b) A lock with nothing pending, on a Worker that has already
          //     surfaced the loss above. Nothing more can be lost here.
          const lossless = await reportOf(() =>
            api.mutate([api.poisoning.buildClean(id)]),
          );

          return { lossy, lossless };
        },
        { id: workspaceId, count: VICTIM_EMPLOYEE_COUNT },
      );

      console.log(`S1/reporting: ${JSON.stringify(reports)}`);

      // The lossy side names the loss, under its own code.
      expect(
        reports.lossy,
        `F144 — a discarded durability window must report under its own code: ${JSON.stringify(reports)}`,
      ).toContain(DISCARDED_WRITES_CODE);

      // The lossless side must NOT, or the code means nothing.
      expect(
        reports.lossless,
        `an ordinary locked store must not claim writes were discarded: ${JSON.stringify(reports)}`,
      ).not.toContain(DISCARDED_WRITES_CODE);
      expect(
        reports.lossless,
        `and must still report the plain locked-store failure: ${JSON.stringify(reports)}`,
      ).toBe(LOSSLESS_LOCK_REPORT_MESSAGE);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The trigger, unattended.
   *
   * Every test above calls `refreshRole()` directly. That is the same method
   * `#startRolePolling`'s timer calls — removing the wait, not changing the
   * path — but "the same method" is an inference, and S1's severity turns on
   * this happening to a user who does nothing at all.
   *
   * So this one revokes the membership and then just waits. No refresh call,
   * no interaction: the runtime's own 15-second poll is the only thing that
   * can lock the store, and if it does, every scenario above is self-
   * triggering rather than test-driven.
   */
  test("trigger: the unattended role poll locks the store on its own after revocation", async ({
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

      const lockedBefore = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return (await api.getStatus()).locked;
      });
      expect(lockedBefore, "the store must be unlocked before the revocation").toBe(
        false,
      );

      await revokeMembership(sql, workspaceId, sharedAccount.userId);

      // ROLE_REFRESH_POLL_INTERVAL_MS is 15s. Poll the STATUS (which needs no
      // unlock and cannot itself cause a lock) until the runtime's own timer
      // acts, rather than sleeping a fixed period and hoping.
      const observed = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const startedAt = performance.now();
        for (;;) {
          if ((await api.getStatus()).locked) {
            return { locked: true, afterMs: performance.now() - startedAt };
          }
          if (performance.now() - startedAt > 45_000) {
            return { locked: false, afterMs: performance.now() - startedAt };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      });

      console.log(`S1/trigger unattended poll: ${JSON.stringify(observed)}`);
      expect(
        observed.locked,
        `the runtime's own poll must lock the store with no interaction: ${JSON.stringify(observed)}`,
      ).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
