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
 * FDN-92 Stage 3: the generic-edge CRDT storage and write path, proven end
 * to end in real Chromium — the FDN-50 Stage 5 standard.
 *
 * Everything is real: real Chromium, real Postgres, the real FDN-84 sealed
 * store behind a real online unlock, real Loro WASM, real SQLite-WASM, and
 * the real `LocalGraphWorkerRuntime` — with the edge writes going through
 * the real `mutate` gate (`authorizeEdgeWrite` + the registry-declared
 * governing-partition resolution, FDN-92 Stage 2), never a stub. The proof
 * runs inside a test-only Worker
 * (`packages/graph/src/worker/testing/runtime-edge-write-proof.worker.ts`),
 * which is how query results are read back WITHOUT an application-facing
 * read path — F105 reserves that for FDN-53.
 *
 * Q3 precondition: `has_skill` / `holds_certification` are governed by
 * Employee's `operational` partition. The tests that write them run under an
 * `hr-admin` membership, which the `VPS-A004` matrix puts at Full on
 * `Employee:operational`; the "a Read-only role is denied" test runs the
 * same write under `finance-admin` (Read, not Full, on that partition) and
 * asserts the denial names `Employee/operational`.
 *
 * MUTATION SPOT-CHECKS (hand-edit the source, run, then hand-revert — never
 * `git checkout`):
 *
 *  1. A no-op commit that skips materialization fails the round-trip.
 *     In `packages/graph/src/worker/runtime.ts` `#commitDeltaBatch`, guard
 *     `await this.#materialize()` behind a "batch looks non-empty" check so a
 *     re-applied batch is skipped. The "reopen" test then fails: either
 *     `generationAfterReapply` no longer advances past `generationAfterWrite`,
 *     or `toNodeIdsAfterReopen` comes back empty because the edge never
 *     reached SQLite.
 *
 *  2. A key scheme that collapses `(edge_type, from_node_id)` fails the
 *     `governed_by` disambiguation. In
 *     `packages/graph/src/worker/document-edge-fragments.ts`, change
 *     `edgeFragmentKey` to return `` `${edgeId}` `` replaced by a composite of
 *     the record's `edge_type` and `from_node_id` (and update the writer in
 *     `edge-write-proof.ts` to match). PayRun's two `governed_by` edges then
 *     share one slot in `__vulto_edge_fragments`; the "governed_by" test
 *     fails with one governor node id instead of two.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple edge write path 92!";

interface EdgeConvergedSide {
  statuses: string[];
  skillToNodeIds: string[];
  certToNodeIds: string[];
  edgeCanonical: string;
}
interface EdgeWriteDiagnostics {
  edgeWrite: {
    runUnion(
      workspaceIdAB: string,
      workspaceIdBA: string,
    ): Promise<{ ab: EdgeConvergedSide; ba: EdgeConvergedSide }>;
    runFieldByField(workspaceId: string): Promise<{
      statuses: string[];
      edgeCount: number;
      effectiveTo: string | null;
      metadata: unknown;
    }>;
    runReopen(workspaceId: string): Promise<{
      generationAfterWrite: number;
      generationAfterReapply: number;
      canonicalBeforeReopen: string;
      canonicalAfterReopen: string;
      toNodeIdsBeforeReopen: string[];
      toNodeIdsAfterReopen: string[];
    }>;
    runGovernedBy(workspaceId: string): Promise<{
      statuses: string[];
      governorNodeIds: string[];
    }>;
    runDenied(workspaceId: string): Promise<{ status: string; reason: string }>;
    createOfflineProof(): {
      open(): Promise<{ opened: boolean }>;
      prove(): Promise<{
        status: string;
        generationBefore: number;
        generationAfter: number;
        toNodeIds: string[];
        canonical: string;
      }>;
      dispose(): void;
    };
    skillId: string;
    certificationId: string;
    payrollPolicyId: string;
    taxConfigId: string;
  };
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn92-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Edge Write Path Browser");
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
  role: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Edge Write Path Co', ${`edge-write-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function unlockAndWait(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

async function openDiagnostics(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await unlockAndWait(page);
}

test.describe.configure({ mode: "serial" });

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

test.describe("FDN-92 Stage 3 generic-edge CRDT write path", () => {
  test("two devices, two edge types, converge to the same query result and index regardless of merge order", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceIdAB = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );
      const workspaceIdBA = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );

      await openDiagnostics(page, workspaceIdAB);
      const proof = await page.evaluate(
        async ({ ab, ba }) => {
          const api = (
            window as unknown as {
              __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
            }
          ).__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          const result = await api.edgeWrite.runUnion(ab, ba);
          return {
            result,
            skillId: api.edgeWrite.skillId,
            certId: api.edgeWrite.certificationId,
          };
        },
        { ab: workspaceIdAB, ba: workspaceIdBA },
      );

      const { ab, ba } = proof.result;
      // Both edge writes were authorized through the real gate, both orders.
      expect(ab.statuses).toEqual(["applied", "applied"]);
      expect(ba.statuses).toEqual(["applied", "applied"]);
      // The union: has_skill points at the skill, holds_certification at the
      // certification, on both devices.
      expect(ab.skillToNodeIds).toEqual([proof.skillId]);
      expect(ab.certToNodeIds).toEqual([proof.certId]);
      expect(ba.skillToNodeIds).toEqual([proof.skillId]);
      expect(ba.certToNodeIds).toEqual([proof.certId]);
      // And the materialized edge projection is byte-identical regardless of
      // the order the two devices' deltas merged in.
      expect(ab.edgeCanonical).toBe(ba.edgeCanonical);
      expect(ab.edgeCanonical).toContain("has_skill");
      expect(ab.edgeCanonical).toContain("holds_certification");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("both devices write the same edge_id on different fields: one edge, both fields, field-by-field merge", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );

      await openDiagnostics(page, workspaceId);
      const result = await page.evaluate(async (id) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.edgeWrite.runFieldByField(id);
      }, workspaceId);

      expect(result.statuses).toEqual(["applied", "applied"]);
      // One edge — the concurrent writes did not fork it into two.
      expect(result.edgeCount).toBe(1);
      // Device A's effective_to survived...
      expect(result.effectiveTo).toBe("2026-06-01T00:00:00.000Z");
      // ...and so did device B's metadata write. A whole-edge LWW register
      // would have kept only one of the two.
      expect((result.metadata as { proficiency?: string }).proficiency).toBe("expert");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("write, re-apply (materialization runs again, not skipped), then close and reopen: the edge is still queryable", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );

      await openDiagnostics(page, workspaceId);
      const { result, skillId } = await page.evaluate(async (id) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return {
          result: await api.edgeWrite.runReopen(id),
          skillId: api.edgeWrite.skillId,
        };
      }, workspaceId);

      // Re-applying the same bytes re-materialized from scratch — the
      // generation advanced rather than the work being skipped.
      expect(result.generationAfterReapply).toBeGreaterThan(
        result.generationAfterWrite,
      );
      // The edge was queryable before the close...
      expect(result.toNodeIdsBeforeReopen).toEqual([skillId]);
      // ...and again after reopening on a genuinely separate runtime whose
      // SQLite index started empty and had to re-materialize the reopened
      // sealed document.
      expect(result.toNodeIdsAfterReopen).toEqual([skillId]);
      // The reopened index is identical to the one that was closed.
      expect(result.canonicalAfterReopen).toBe(result.canonicalBeforeReopen);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("governed_by disambiguation: PayRun's two governors survive as two distinct edges", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      // governed_by's endpoints are all single-partition Finance-restricted;
      // finance-admin is Full on all three. This test does not touch the
      // split-endpoint ruling at all.
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "finance-admin",
      );

      await openDiagnostics(page, workspaceId);
      const { result, payrollPolicyId, taxConfigId } = await page.evaluate(
        async (id) => {
          const api = (
            window as unknown as {
              __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
            }
          ).__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return {
            result: await api.edgeWrite.runGovernedBy(id),
            payrollPolicyId: api.edgeWrite.payrollPolicyId,
            taxConfigId: api.edgeWrite.taxConfigId,
          };
        },
        workspaceId,
      );

      expect(result.statuses).toEqual(["applied", "applied"]);
      // Two distinct governors — a storage key that folded in
      // (edge_type, from_node_id) would have kept only one.
      expect(result.governorNodeIds).toEqual([payrollPolicyId, taxConfigId].sort());
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("a role that is only Read on Employee/operational cannot write has_skill", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "finance-admin",
      );

      await openDiagnostics(page, workspaceId);
      const result = await page.evaluate(async (id) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.edgeWrite.runDenied(id);
      }, workspaceId);

      // finance-admin is Read (not Full) on Employee/operational — the
      // registry-declared governing partition for has_skill. The gate
      // resolves against operational, not against a partition the role
      // happens to hold Full on.
      expect(result.status).toBe("denied");
      expect(result.reason).toContain("Employee/operational");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("has_skill written, then converged, materialized and queried with the network cut", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );

      await openDiagnostics(page, workspaceId);

      const opened = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const handle = api.edgeWrite.createOfflineProof();
        (window as unknown as { __edgeOffline?: unknown }).__edgeOffline = handle;
        return handle.open();
      });
      expect(opened.opened).toBe(true);

      await context.setOffline(true);
      const reachable = await page.evaluate(async (origin) => {
        try {
          await fetch(`${origin}/health`, { cache: "no-store" });
          return true;
        } catch {
          return false;
        }
      }, apiOrigin);
      expect(reachable).toBe(false);

      const { result, skillId } = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics?: EdgeWriteDiagnostics;
          }
        ).__vultoGraphPersistenceDiagnostics!;
        const handle = (
          window as unknown as {
            __edgeOffline?: {
              prove(): Promise<{
                status: string;
                generationBefore: number;
                generationAfter: number;
                toNodeIds: string[];
                canonical: string;
              }>;
              dispose(): void;
            };
          }
        ).__edgeOffline;
        if (!handle) throw new Error("offline handle missing");
        const proof = await handle.prove();
        handle.dispose();
        return { result: proof, skillId: api.edgeWrite.skillId };
      });

      // The edge write was authorized and committed offline...
      expect(result.status).toBe("applied");
      // ...materialized offline (generation advanced)...
      expect(result.generationAfter).toBeGreaterThan(result.generationBefore);
      // ...and the SQLite index answered the traversal offline.
      expect(result.toNodeIds).toEqual([skillId]);
      expect(result.canonical.length).toBeGreaterThan(0);
    } finally {
      await context?.setOffline(false).catch(() => undefined);
      await context?.close();
      await sql.end();
    }
  });
});
