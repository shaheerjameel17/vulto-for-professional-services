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
 * FDN-50 stage 4: the `managed_by` materialization proof, in real Chromium.
 *
 * Everything here is real: real Loro (two genuinely separate `LoroDoc`
 * instances for the concurrency proof, never one simulating two and never a
 * mocked merge), the real FDN-84 sealed store behind a real online unlock,
 * and the real production Worker driven through its real protocol. It reuses
 * the account/workspace/unlock machinery of graph-persistence.spec.ts rather
 * than inventing a second way to get there.
 *
 * The rule under proof is `VPS-A002`'s single-active-outgoing section and
 * `VPS-A001`'s Movable Tree section, as corrected by F104 and F124: the Tree
 * is the sole write target and sole authority on who manages a person right
 * now, `(lamport, peer)` selects which concurrent move wins, and the
 * effective date is carried on the move operation itself.
 */

/**
 * A local, self-contained handle on the diagnostics harness.
 *
 * graph-persistence.spec.ts augments `Window` with its own view of this
 * object; re-declaring the same property here with a wider type would
 * conflict rather than merge, so this file casts through `unknown` to its
 * own interface instead. Nothing in this directory is inside a tsconfig
 * `include`, so the cast is for the reader and the editor, not a compiler
 * gate.
 */
interface ManagedByDiagnostics {
  initialize(): Promise<void>;
  applyDeltaBatch(
    base64Snapshots: readonly string[],
  ): Promise<{ mergedDeltaCount: number }>;
  openPayload(storeKey: string): Promise<string | null>;
  storeKeyFor(workspaceId: string): string;
  managedBy: {
    buildConcurrentMoveSnapshots(): {
      seed: string;
      deviceA: string;
      deviceB: string;
    };
    buildSequentialMoveSnapshot(): string;
    buildBackdatedMoveSnapshot(): string;
    buildEmployeeFragments(workspaceId: string): string;
    materializeFromSnapshots(
      base64Snapshots: readonly string[],
    ): Promise<{ summary: string[]; canonical: string }>;
    resolvedManagerOf(base64Snapshots: readonly string[]): string | null;
    employeeId: string;
    managerAId: string;
    managerBId: string;
  };
}

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple managed by 50!";

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn50s4-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Managed By Browser");
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

async function createWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Managed By Browser Co', ${`managed-by-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function unlockAndWait(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe.configure({ mode: "serial" });

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // F122: every spec file in this directory resets the rate-limit window
    // before signing up, so one file's sign-ups cannot exhaust the next
    // file's. The limit itself is never relaxed.
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-50 stage 4 managed_by materialization", () => {
  test("converges on one identical edge history from two offline devices, in either merge order", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const proof = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        // Two genuinely separate offline documents, each moving the SAME
        // employee to a DIFFERENT manager.
        const { seed, deviceA, deviceB } = api.managedBy.buildConcurrentMoveSnapshots();

        // 1. Merge them, both ways round. No cycle, no error.
        const aThenB = await api.managedBy.materializeFromSnapshots([
          seed,
          deviceA,
          deviceB,
        ]);
        const bThenA = await api.managedBy.materializeFromSnapshots([
          seed,
          deviceB,
          deviceA,
        ]);

        return {
          aThenB,
          bThenA,
          // 2. One deterministic winner for the employee's parent, agreed by
          // both merge orders — read from the Tree itself, not from the edges.
          parentAThenB: api.managedBy.resolvedManagerOf([seed, deviceA, deviceB]),
          parentBThenA: api.managedBy.resolvedManagerOf([seed, deviceB, deviceA]),
          employeeId: api.managedBy.employeeId,
          managerAId: api.managedBy.managerAId,
          managerBId: api.managedBy.managerBId,
        };
      });

      // 2. The Tree converges on one parent regardless of merge order.
      expect(proof.parentAThenB).toBe(proof.parentBThenA);
      expect(proof.parentAThenB).toBe(proof.managerBId);

      // 3. Each device's materializer produces the IDENTICAL edge history —
      // same intervals, same target, same deterministic edge ids.
      expect(proof.aThenB.canonical).toBe(proof.bThenA.canonical);
      expect(proof.aThenB.summary).toEqual(proof.bThenA.summary);

      // 4. The losing move never persists as its own materialized active
      // period. Peer 22 wins the (lamport, peer) tie-break, so MANAGER_B is
      // the only manager in the history and MANAGER_A appears nowhere.
      expect(proof.aThenB.summary).toEqual([
        `${proof.employeeId} -> ${proof.managerBId} [2026-04-01T00:00:00.000Z, null)`,
      ]);
      expect(proof.aThenB.canonical).not.toContain(proof.managerAId);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("materializes an identical history from bytes that round-tripped the sealed store", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const storeKey = await page.evaluate((id) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.storeKeyFor(id);
      }, workspaceId);

      await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      // Feed both offline devices' bytes through the REAL production
      // applyDeltaBatch entrypoint, so the Worker's own document merges them.
      //
      // FDN-50 stage 5 wired materialization into that entrypoint, which
      // made a requirement real that was invisible while the live path
      // ignored the Tree: a materialized `managed_by` edge is refused
      // unless both of its endpoints are themselves materialized. The three
      // employees' node records are therefore merged first, so the runtime
      // receives a COMPLETE workspace document rather than a Tree with no
      // people in it. Nothing this test asserts changed.
      const expected = await page.evaluate(async (id) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const { seed, deviceA, deviceB } = api.managedBy.buildConcurrentMoveSnapshots();
        await api.applyDeltaBatch([
          api.managedBy.buildEmployeeFragments(id),
          seed,
          deviceA,
          deviceB,
        ]);
        const direct = await api.managedBy.materializeFromSnapshots([
          seed,
          deviceA,
          deviceB,
        ]);
        return direct;
      }, workspaceId);

      // Past the 250ms debounce window, so the durable flush has landed.
      await page.waitForTimeout(400);

      // Reload: a real page reload disposes the client and terminates the
      // real Worker, so this is a genuinely new Worker instance that must
      // unlock online again and re-import from the sealed store.
      await page.reload();
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      const fromSealedStore = await page.evaluate(async (key) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const sealed = await api.openPayload(key);
        if (sealed === null) throw new Error("nothing was persisted");
        // Materialize from the bytes the sealed store actually gave back.
        return api.managedBy.materializeFromSnapshots([sealed]);
      }, storeKey);

      expect(fromSealedStore.summary).toEqual(expected.summary);
      expect(fromSealedStore.canonical).toBe(expected.canonical);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("materializes one close-plus-open pair for an ordinary single-device move", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const result = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.managedBy.buildSequentialMoveSnapshot();
        const history = await api.managedBy.materializeFromSnapshots([snapshot]);
        return {
          history,
          employeeId: api.managedBy.employeeId,
          managerAId: api.managedBy.managerAId,
          managerBId: api.managedBy.managerBId,
        };
      });

      // Exactly one close-plus-open pair, half-open `[from, to)`: the prior
      // edge closes at the exact instant its replacement opens.
      expect(result.history.summary).toEqual([
        `${result.employeeId} -> ${result.managerAId} [2026-01-01T00:00:00.000Z, 2026-03-01T00:00:00.000Z)`,
        `${result.employeeId} -> ${result.managerBId} [2026-03-01T00:00:00.000Z, null)`,
      ]);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("refuses a backdated move instead of rewriting history (F125)", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const attempt = await page
        .evaluate(async () => {
          const api = (
            window as unknown as {
              __vultoGraphPersistenceDiagnostics?: ManagedByDiagnostics;
            }
          ).__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          const snapshot = api.managedBy.buildBackdatedMoveSnapshot();
          const history = await api.managedBy.materializeFromSnapshots([snapshot]);
          return `succeeded: ${JSON.stringify(history.summary)}`;
        })
        .catch((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        );

      // F125 is deliberately open. A backdated move must be refused loudly,
      // never silently accepted into overlapping or rewritten history.
      expect(attempt).not.toContain("succeeded");
      expect(attempt).toContain("F125");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
