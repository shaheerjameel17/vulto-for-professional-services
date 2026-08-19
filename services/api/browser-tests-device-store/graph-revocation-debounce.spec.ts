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
 * **This file reproduces; it does not assert a fix.** It answers the two
 * questions FDN-54 names, against the real stack — real Postgres, real
 * Chromium, real `SealedStore` behind a real online unlock, real Loro and
 * SQLite WASM, real revocation through the real `member` row, and the real
 * production `mutate`/`refresh-role`/`query` protocol messages. Every
 * assertion below either establishes that the scenario genuinely set itself
 * up, or records what the system actually did.
 *
 *   Q1. A write this device was authorized to make, was told was `applied`,
 *       and never got to disk. Is losing it correct?
 *   Q2. Should a revoked device retain a materialized plaintext index — and
 *       the plaintext Loro document behind it — in memory after revocation?
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

const STEP_TIMEOUT_MS = 20_000;

/**
 * What `mutate` reports to a caller once the sealed store is locked.
 *
 * Pinned as a literal on purpose, and asserted from BOTH sides: the
 * `ordering` test asserts a run that DID lose a write reports exactly this,
 * and the `discriminator` test asserts a run that lost NOTHING reports
 * exactly this too. Neither assertion means anything without the other —
 * one side alone would still pass if the lossy path were later made
 * distinguishable, which is precisely the fix this file must be able to
 * detect.
 */
const LOCK_REPORT_MESSAGE = "runtime-failure: The sealed local store is locked";

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

async function tryInitialize(
  page: Page,
): Promise<{ opened: boolean; error?: string }> {
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

/** A throw out of `mutate` is reported by the harness as the step's value, not as a rejection. */
const reportedThrow = (step: StepOutcome): string | undefined =>
  (step.value as MutationOutcomeShape | undefined)?.thrown;

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
   * Q1. The device was authorized, was told `applied`, and the write never
   * reached disk. This reads the durable snapshot back through a genuinely
   * new Worker to establish what survived.
   */
  test("Q1: an authorized write acknowledged inside the debounce window is lost when revocation lands", async ({
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
      expect(
        status(seed),
        `the durable seed must apply: ${JSON.stringify(seed)}`,
      ).toBe("applied");

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
      // Recorded, not asserted: this is the observation Q2 turns on and the
      // first pass has no ruling to assert against yet.
      console.log(
        `S1/Q1 while revoked: query=${JSON.stringify(run.queryWhileLocked)} mutate=${JSON.stringify(run.mutateWhileLocked)}`,
      );

      // --- what actually reached disk ------------------------------------
      await restoreMembership(sql, workspaceId, sharedAccount.userId);
      await openWorkspace(page, workspaceId);
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `the workspace must still open after a revoked interval: ${reopened.error}`,
      ).toBe(true);

      const seedSurvived = await employeeVisible(page, "77777777-7777-4777-8777-777777777777");
      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S1/Q1 durable state: seed=${JSON.stringify(seedSurvived)} victim=${JSON.stringify(victimSurvived)}`,
      );

      // The control. If the seed did not survive either, the run proves
      // nothing about the debounce window — it proves the reopen is broken.
      expect(
        (seedSurvived.value as { present?: boolean } | undefined)?.present,
        `the pre-revocation seed must be durable, or this run cannot isolate the window: ${JSON.stringify(seedSurvived)}`,
      ).toBe(true);

      // The finding itself, stated as the reproduction it is.
      expect(
        (victimSurvived.value as { present?: boolean } | undefined)?.present,
        `S1/Q1 REPRODUCED — the acknowledged write is absent from disk: ${JSON.stringify(victimSurvived)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * Q2. `lockSealedStore()` drops the AES key and the role set. It does not
   * touch `#document` or `#index` — the plaintext Loro document and the
   * materialized SQLite index stay allocated in the Worker.
   *
   * Structure alone would only prove the code does not free them. This
   * observes whether the plaintext is INTACT across the revoked interval, by
   * the one instrument that can ask without destroying the answer: re-unlock
   * the SAME Worker and read. If the victim write — which never reached disk
   * — comes back, the plaintext survived the revocation in memory. If only
   * the durable seed comes back, the runtime discarded it.
   *
   * Deliberately does NOT query while locked. That throw is fatal and
   * terminates the Worker, which would destroy the state under inspection
   * and turn a real answer into an artifact of the probe.
   */
  test("Q2: a revoked device keeps its materialized plaintext index in memory", async ({
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
      expect(
        status(seed),
        `the durable seed must apply: ${JSON.stringify(seed)}`,
      ).toBe("applied");

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
      console.log(`S1/Q2 shell still rendering unlocked after revocation: ${shellStillUnlocked}`);

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

      const victimStillInMemory = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S1/Q2 in-memory state after re-unlock: victim=${JSON.stringify(victimStillInMemory)}`,
      );

      // The finding, and the reason it holds WITHIN this run rather than by
      // borrowing Q1's separate workspace: the index is opened `:memory:`,
      // and the only code that ever reads the durable snapshot back is
      // `initialize()`. Re-unlocking does not call it — `unlockSealedStore`
      // only re-derives the key. So whatever answers this query was never
      // read from disk during this run, whatever disk happens to hold.
      expect(
        (victimStillInMemory.value as { present?: boolean } | undefined)?.present,
        `S1/Q2 REPRODUCED — plaintext never persisted is still readable from the Worker's memory after revocation: ${JSON.stringify(victimStillInMemory)}`,
      ).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
  /**
   * The control. Identical in every respect except that the revocation is
   * allowed to land AFTER the flush window has closed.
   *
   * Without this, Q1 proves only "a write went missing near a revocation" —
   * it could just as well be the reopen, the fixture, or the revocation
   * itself discarding data. With it, the debounce window is isolated as the
   * cause: same write, same revocation, same reopen, different timing, and
   * the write survives.
   */
  test("control: the same write, revoked AFTER the window closes, is durable", async ({
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
      expect(
        reopened.opened,
        `the workspace must still open: ${reopened.error}`,
      ).toBe(true);

      const victimSurvived = await employeeVisible(page, FIRST_VICTIM_EMPLOYEE);
      console.log(
        `S1/control durable state: victim=${JSON.stringify(victimSurvived)}`,
      );
      expect(
        (victimSurvived.value as { present?: boolean } | undefined)?.present,
        `the window is the cause — the same write must be durable when the revocation lands after it: ${JSON.stringify(victimSurvived)}`,
      ).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * What a caller can learn about the loss.
   *
   * `#pendingFlushError` exists so a failed background flush is never
   * swallowed: it is re-thrown at the start of the next `mutate`,
   * `applyDeltaBatch` or `dispose`. Q1's run probed with a query first and
   * the flush error never surfaced at all — the query's own lock failure is
   * fatal, so the Worker died and took `#pendingFlushError` with it.
   *
   * This runs the other ordering, where the mechanism does get its chance,
   * to establish whether it makes the data loss distinguishable from an
   * ordinary lock. Recorded rather than asserted: the question is what the
   * message SAYS, and there is no ruling yet to assert against.
   */
  test("ordering: what the first call after the lock reports about the lost write", async ({
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
        probeWhileLocked: "mutate-first",
        delayBeforeRefreshMs: 0,
      });

      expect(
        status(run.victim),
        `the victim write must be authorized and applied: ${JSON.stringify(run.victim)}`,
      ).toBe("applied");
      expect(
        run.lockLandedAfterMs,
        `the revocation must land inside the ${FLUSH_DEBOUNCE_MS}ms window (took ${run.lockLandedAfterMs}ms)`,
      ).toBeLessThan(FLUSH_DEBOUNCE_MS);

      console.log(
        `S1/ordering mutate-first: mutate=${JSON.stringify(run.mutateWhileLocked)} query=${JSON.stringify(run.queryWhileLocked)}`,
      );

      // The lossy side of the comparison F144 rests on. This run's pending
      // flush failed and its write is gone; `mutate` is the call that gives
      // `#pendingFlushError` its chance to say so, and this is everything it
      // says. The `discriminator` test asserts the identical string from a
      // run that lost nothing — together they establish that the report
      // carries no information about the loss, and either assertion alone
      // would keep passing after a fix.
      expect(
        reportedThrow(run.mutateWhileLocked ?? {}),
        `the lossy path must report exactly the lock message: ${JSON.stringify(run.mutateWhileLocked)}`,
      ).toBe(LOCK_REPORT_MESSAGE);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
  /**
   * The discriminator for the claim the ordering test above suggests.
   *
   * `SealedStoreLockedError` carries one fixed message and is thrown from
   * BOTH places that matter here: `SealedStore.put` (the failed background
   * flush, captured into `#pendingFlushError`) and the `roles` getter
   * (`mutate`'s own first read of a locked store). Reading that from source
   * is not proof that a caller cannot tell them apart.
   *
   * So this runs the same revocation with NOTHING pending — the seed's flush
   * has long since landed, no write is in flight, no data is lost — and
   * records what `mutate` reports. If it is identical to the run where a
   * write WAS lost, then the message a caller receives carries no
   * information about the loss, and `#pendingFlushError`'s guarantee that a
   * background failure is "never swallowed" is satisfied in letter only.
   */
  test("discriminator: a lock with nothing pending reports exactly what a lock with a lost write reports", async ({
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
      // The ONLY write, and its flush is fully settled before the revocation.
      const seed = await seedDurably(page, workspaceId);
      expect(status(seed), `the durable seed must apply: ${JSON.stringify(seed)}`).toBe(
        "applied",
      );

      await revokeMembership(sql, workspaceId, sharedAccount.userId);
      const clean = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        let refreshDenied = false;
        try {
          await api.refreshRole();
        } catch {
          refreshDenied = true;
        }
        const locked = (await api.getStatus()).locked;
        // Nothing is pending, so nothing can be lost here.
        await new Promise((resolve) => setTimeout(resolve, 900));
        try {
          const value = await api.mutate([api.poisoning.buildClean(id)]);
          // The harness reports a throw out of `mutate` as `{ thrown }`
          // rather than rethrowing, so this is the caller-visible message.
          return { refreshDenied, locked, mutate: value.thrown ?? JSON.stringify(value) };
        } catch (error: unknown) {
          return {
            refreshDenied,
            locked,
            mutate: `REJECTED: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }, workspaceId);

      expect(clean.refreshDenied, "the server must deny the refresh").toBe(true);
      expect(clean.locked, "a denied refresh must lock the store").toBe(true);
      console.log(`S1/discriminator no-pending-flush: mutate=${clean.mutate}`);

      // The lossless side of the comparison. Nothing was pending here, so
      // nothing was lost — and the message is identical to the one the
      // `ordering` test asserts from a run that DID lose a write.
      expect(
        clean.mutate,
        `a lossless lock must report exactly what a lossy one does, or the two are distinguishable and this claim is wrong: ${clean.mutate}`,
      ).toBe(LOCK_REPORT_MESSAGE);
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
