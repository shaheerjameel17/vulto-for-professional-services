import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * FDN-50 stage 5: the complete chain, in real Chromium.
 *
 *   a Movable Tree move  ->  materialized `managed_by` edges
 *                        ->  the SQLite-WASM index  ->  queried back
 *
 * and then the same answers again after a genuine close and reopen, so
 * FDN-50's "a workspace can be created, mutated, closed, reopened,
 * materialized, and queried offline" is proven as ONE path rather than as
 * several that happen to share a document.
 *
 * Everything is real: the real `LocalGraphWorkerRuntime`, the real FDN-84
 * sealed store behind a real online unlock, real Loro WASM, real
 * SQLite-WASM. The proof runs inside a test-only Worker (see
 * `packages/graph/src/worker/testing/runtime-chain-proof.worker.ts`), which
 * is how query results are read back WITHOUT adding an application-facing
 * read path — F105 reserves that for FDN-53, behind `VPS-A004`'s permission
 * interceptor.
 *
 * It reuses the account/workspace/unlock machinery of the other spec files
 * in this directory rather than inventing a second way to get there.
 */

interface ChainProofResult {
  employeesBeforeMutation: number;
  employeesAfterMutation: number;
  generationAfterFirstBatch: number;
  generationAfterSecondBatch: number;
  generationAfterReapply: number;
  managerAfterFirstBatch: string | null;
  managerBeforeFirstEffectiveDate: string | null;
  managerAfterReassignment: string | null;
  managerDuringFirstInterval: string | null;
  canonicalBeforeReopen: string;
  canonicalAfterReapply: string;
  canonicalAfterReopen: string;
  employeesAfterReopen: number;
  managerAfterReopen: string | null;
  managerDuringFirstIntervalAfterReopen: string | null;
  danglingEndpointRefusal: string;
  durationMs: number;
}

/**
 * A local, self-contained handle on the diagnostics harness, for the same
 * reason the stage 4 spec declares its own: `graph-persistence.spec.ts`
 * augments `Window` with its own view of this object, and re-declaring the
 * same property with a wider type here would conflict rather than merge.
 */
interface OfflineProofResult {
  employeesAfterOfflineMutation: number;
  managerAfterOfflineMutation: string | null;
  managerBeforeFirstEffectiveDate: string | null;
  generationBefore: number;
  generationAfter: number;
  canonical: string;
}

interface ChainDiagnostics {
  runChainProof(danglingWorkspaceId: string): Promise<ChainProofResult>;
  createOfflineProof(): {
    open(): Promise<{ opened: boolean }>;
    prove(): Promise<OfflineProofResult>;
    dispose(): void;
  };
  managedBy: {
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
const password = "Correct horse battery staple chain proof 50!";

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn50s5-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Chain Proof Browser");
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
    values (${workspaceId}, 'Chain Proof Browser Co', ${`chain-proof-${workspaceId}`}, now(), 'active')`;
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

test.describe("FDN-50 stage 5 CRDT-to-query-layer chain", () => {
  test("maps a Tree move through materialization into SQLite and answers it back, across a close and reopen", async ({
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
      // A second, separate workspace for the dangling-endpoint refusal, so
      // it meets a document that genuinely lacks the manager's record.
      const danglingWorkspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
      );

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const proof = await page.evaluate(async (dangling) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ChainDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const result = await api.runChainProof(dangling);
        return {
          result,
          employeeId: api.managedBy.employeeId,
          managerAId: api.managedBy.managerAId,
          managerBId: api.managedBy.managerBId,
        };
      }, danglingWorkspaceId);

      const {
        result,
        managerAId,
        managerBId,
      }: {
        result: ChainProofResult;
        managerAId: string;
        managerBId: string;
      } = proof;

      // 1. A workspace with no document materializes to an empty query
      //    surface. Nothing is invented for it.
      expect(result.employeesBeforeMutation).toBe(0);

      // 2. Mutating through the real applyDeltaBatch puts the document's
      //    node records into SQLite — three Employees, queried back.
      expect(result.employeesAfterMutation).toBe(3);

      // 3. The Tree move became a `managed_by` edge, and the QUERY answers
      //    with manager A. Nothing wrote that edge: the only write was a
      //    Tree move (F104).
      expect(result.managerAfterFirstBatch).toBe(managerAId);

      // 4. The interval is half-open and starts at the date carried on the
      //    move (F124), so before that date there is no reporting line.
      expect(result.managerBeforeFirstEffectiveDate).toBeNull();

      // 5. A second, forward-effective move reassigns the employee, and
      //    history survives: the earlier instant still answers manager A.
      expect(result.managerAfterReassignment).toBe(managerBId);
      expect(result.managerDuringFirstInterval).toBe(managerAId);

      // 6. Re-materializing the same state is idempotent. The generation
      //    advances — the work genuinely ran again rather than being
      //    skipped — and the index it produces is byte-identical.
      expect(result.generationAfterReapply).toBeGreaterThan(
        result.generationAfterSecondBatch,
      );
      expect(result.generationAfterSecondBatch).toBeGreaterThan(
        result.generationAfterFirstBatch,
      );
      expect(result.canonicalAfterReapply).toBe(result.canonicalBeforeReopen);

      // 7. Closed and reopened on a genuinely separate runtime, with its
      //    own sealed store that started locked. Its SQLite index started
      //    empty, so every answer below came from re-materializing the
      //    reopened document.
      expect(result.employeesAfterReopen).toBe(3);
      expect(result.managerAfterReopen).toBe(managerBId);
      expect(result.managerDuringFirstIntervalAfterReopen).toBe(managerAId);

      // 8. And the reopened index is identical to the one that was closed:
      //    CRDT state maps DETERMINISTICALLY to the materialized query
      //    layer, which is FDN-50's own done criterion.
      expect(result.canonicalAfterReopen).toBe(result.canonicalBeforeReopen);
      expect(result.canonicalAfterReopen.length).toBeGreaterThan(0);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("refuses a Tree move whose manager has no node record, rather than indexing an edge into nowhere", async ({
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
      const danglingWorkspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
      );

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      const refusal = await page.evaluate(async (dangling) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: ChainDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const result = await api.runChainProof(dangling);
        return result.danglingEndpointRefusal;
      }, danglingWorkspaceId);

      // The wiring genuinely validates. A materialized edge pointing at an
      // employee the index does not hold is refused by the live path, not
      // written as a dangling row and not silently dropped.
      expect(refusal).not.toBe("succeeded");
      expect(refusal).toContain("absent from the local materialization");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
  test("mutates, materializes and queries with the network cut, after one online unlock", async ({
    browser,
  }) => {
    // Closes FDN-50's "queried offline". The chain proof above walks every
    // other verb in that criterion but runs online throughout, so "offline"
    // was the one claim in this issue resting on reasoning rather than a
    // test — the path has no network call in it, which is an argument about
    // what the code should do, not evidence of what it does.
    //
    // The unlock stays online deliberately: F106 makes it a server
    // round-trip, so unlocking offline would fail for a reason unrelated to
    // what is under test. Network is cut immediately after, and everything
    // asserted below happened with it gone.
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

      // Open the proof Worker's own sealed store while still online.
      const opened = await page.evaluate(async () => {
        const api = (
          window as unknown as { __vultoGraphPersistenceDiagnostics?: ChainDiagnostics }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const handle = api.createOfflineProof();
        (window as unknown as { __offlineProof?: unknown }).__offlineProof = handle;
        return handle.open();
      });
      expect(opened.opened).toBe(true);

      // Cut the network. Nothing below may reach the server.
      await context.setOffline(true);

      // Prove the network really is gone, so a passing assertion below
      // cannot be explained by setOffline having silently not applied.
      const reachable = await page.evaluate(async (origin) => {
        try {
          await fetch(`${origin}/health`, { cache: "no-store" });
          return true;
        } catch {
          return false;
        }
      }, apiOrigin);
      expect(reachable).toBe(false);

      const result = await page.evaluate(async () => {
        const handle = (
          window as unknown as {
            __offlineProof?: { prove(): Promise<OfflineProofResult>; dispose(): void };
          }
        ).__offlineProof;
        if (!handle) throw new Error("offline proof handle missing");
        const proof = await handle.prove();
        handle.dispose();
        return proof;
      });

      const managerAId = await page.evaluate(() => {
        const api = (
          window as unknown as { __vultoGraphPersistenceDiagnostics?: ChainDiagnostics }
        ).__vultoGraphPersistenceDiagnostics;
        return api!.managedBy.managerAId;
      });

      // The mutation was merged and materialized offline.
      expect(result.generationAfter).toBeGreaterThan(result.generationBefore);
      expect(result.employeesAfterOfflineMutation).toBe(3);
      // And the SQLite index answered a real traversal query offline.
      expect(result.managerAfterOfflineMutation).toBe(managerAId);
      // Including the temporal half: before the move's carried effective
      // date there is no reporting line (F124's half-open interval).
      expect(result.managerBeforeFirstEffectiveDate).toBeNull();
      expect(result.canonical.length).toBeGreaterThan(0);
    } finally {
      await context?.setOffline(false).catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });

  test("a graph mutation survives a genuine browser restart, not only a new Worker", async () => {
    // Closes FDN-50's "device restarts". graph-persistence.spec.ts proves
    // survival across a page reload — a new Worker in the same browser
    // session — and device-store.spec.ts proves the sealed BYTES survive a
    // real browser relaunch and stay locked. Neither one then unlocks after
    // that relaunch and reads the graph mutation back, so the end-to-end
    // claim was standing on two halves that never met.
    //
    // This launches a persistent profile, mutates, closes the browser
    // entirely, relaunches on the SAME profile directory, unlocks again, and
    // reads the value back out of the reopened document.
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn50s5-restart-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      let page = context.pages()[0] ?? (await context.newPage());
      const account = await signUp(page, sql);
      const workspaceId = await createWorkspaceMembership(sql, account.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);

      await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: {
              initialize(): Promise<void>;
              buildSnapshot(key: string, value: string): string;
              applyDeltaBatch(snapshots: readonly string[]): Promise<unknown>;
            };
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
        await api.applyDeltaBatch([api.buildSnapshot("survives-restart", "yes")]);
      });

      // Let the 250ms debounced flush land before killing the browser. A
      // clean dispose would flush synchronously, but a browser kill is not
      // a clean dispose — that gap is stage 2's stated tradeoff, not this
      // test's subject.
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const api = (
                window as unknown as {
                  __vultoGraphPersistenceDiagnostics?: {
                    openPayload(key: string): Promise<string | null>;
                    storeKeyFor(id: string): string;
                  };
                }
              ).__vultoGraphPersistenceDiagnostics;
              const params = new URLSearchParams(window.location.search);
              const id = params.get("workspaceId")!;
              return (await api!.openPayload(api!.storeKeyFor(id))) !== null;
            }),
          { timeout: 15_000 },
        )
        .toBe(true);

      // Kill the browser process entirely, not just the page.
      await context.close();
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      page = context.pages()[0] ?? (await context.newPage());
      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      // A relaunched browser starts locked, per F106 — unlock again.
      await unlockAndWait(page);

      const recovered = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: {
              openPayload(key: string): Promise<string | null>;
              readSnapshotValue(snapshot: string, key: string): string | null;
              storeKeyFor(id: string): string;
            };
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const params = new URLSearchParams(window.location.search);
        const id = params.get("workspaceId")!;
        const payload = await api.openPayload(api.storeKeyFor(id));
        if (payload === null) return null;
        return api.readSnapshotValue(payload, "survives-restart");
      });

      expect(recovered).toBe("yes");
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });
});
