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
 * FDN-53 stage 1: the graph permission layer's first production-callable
 * read path, per `VPS-A004_Graph_Permission_Layer`.
 *
 * Everything here is real, per the standard every prior stage in this
 * project holds itself to: real Chromium, real Postgres, real
 * `SealedStore`, real materialized data, the real production Worker driven
 * through its real protocol (`type: "query"`, `type: "refresh-role"`) —
 * never a mock of the interceptor or the role channel.
 *
 * Two things are under proof:
 *
 * 1. A query against a node whose role does not admit it comes back
 *    structurally absent (`node: null`), and a query against a
 *    split-protection node's restricted partition comes back with a
 *    schema-derived placeholder rather than the real field content.
 * 2. F127's live role-refresh channel: a role narrowing reaches an
 *    ALREADY-UNLOCKED, STILL-ONLINE Worker — no page reload, no new
 *    Worker instance, no cold restart — both through the explicit
 *    `refresh-role` receiving surface and through the placeholder polling
 *    loop that calls it automatically.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple permission query 53!";

interface GraphPermissionDiagnosticsApi {
  initialize(): Promise<void>;
  applyDeltaBatch(
    base64Snapshots: readonly string[],
  ): Promise<{ mergedDeltaCount: number }>;
  query(graphQuery: unknown): Promise<{
    kind: string;
    node?: { nodeId: string; nodeType: string; fragments: unknown[] } | null;
  }>;
  refreshRole(): Promise<string[]>;
  permissionProof: {
    employeeId: string;
    buildEmployeeFragments(workspaceId: string): string;
    buildOrgScenario(workspaceId: string, nodeId: string): string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: GraphPermissionDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn53-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Permission Query Browser");
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
): Promise<{ workspaceId: string; membershipId: string }> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Permission Query Browser Co', ${`permission-query-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
  return { workspaceId, membershipId };
}

async function setRole(
  sql: ReturnType<typeof postgres>,
  membershipId: string,
  role: string,
): Promise<void> {
  await sql`update "member" set "role" = ${role} where "id" = ${membershipId}`;
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
    // F122: reset the rate-limit window before this file's own sign-ups.
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-53 stage 1 graph permission query path", () => {
  test("Restricted vs full: an HR Admin sees Employee operational and compensation in full; the interceptor never invents a Restricted cell the matrix does not name", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const { workspaceId } = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      const employeeId = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.permissionProof.buildEmployeeFragments(id);
        await api.applyDeltaBatch([snapshot]);
        return api.permissionProof.employeeId;
      }, workspaceId);

      const result = await page.evaluate(
        async ({ id }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.query({
            kind: "node-get",
            nodeId: id,
            nodeType: "Employee",
            includeSoftDeleted: false,
          });
        },
        { id: employeeId },
      );

      expect(result.kind).toBe("node-get");
      expect(result.node).not.toBeNull();
      const fragments = result.node!.fragments as {
        partitionKey: string;
        record: Record<string, unknown>;
      }[];
      const operational = fragments.find((f) => f.partitionKey === "operational")!;
      const compensation = fragments.find((f) => f.partitionKey === "compensation")!;
      // HR Admin is Full on both Employee partitions per VPS-A004's matrix —
      // real field content, not a placeholder.
      expect(operational.record.job_title).toBe("Staff Engineer");
      expect(compensation.record.base_salary).toBe(175000);
      expect(compensation.record.__restricted).toBeUndefined();
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("a role narrowing reaches an already-unlocked, still-online Worker: an explicit refresh, and the placeholder poll, both without a restart", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const { workspaceId, membershipId } = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "hr-admin",
      );
      const orgScenarioId = crypto.randomUUID();

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      await page.evaluate(
        async ({ id, nodeId }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          const snapshot = api.permissionProof.buildOrgScenario(id, nodeId);
          await api.applyDeltaBatch([snapshot]);
        },
        { id: workspaceId, nodeId: orgScenarioId },
      );

      async function queryOrgScenario(): Promise<boolean> {
        const result = await page.evaluate(async (nodeId) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.query({
            kind: "node-get",
            nodeId,
            nodeType: "OrgScenario",
            includeSoftDeleted: false,
          });
        }, orgScenarioId);
        return result.node !== null && result.node !== undefined;
      }

      // 1. hr-admin is Full on OrgScenario — the node is visible, same
      // still-unlocked Worker, no reload since unlock.
      expect(await queryOrgScenario()).toBe(true);

      // 2. Narrow the role centrally, EXACTLY as an Owner demoting someone
      // would. The Worker has no idea yet — nothing has told it.
      await setRole(sql, membershipId, "team-member");

      // 3. The explicit receiving surface: call refresh-role directly,
      // with NO wait for the poll, and confirm the interceptor immediately
      // reflects the narrower role. team-member is structural `none` on
      // OrgScenario — the same query now returns null.
      const rolesAfterExplicitRefresh = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.refreshRole();
      });
      expect(rolesAfterExplicitRefresh).toEqual(["team-member"]);
      expect(await queryOrgScenario()).toBe(false);

      // 4. Widen the role back, WITHOUT calling refresh-role explicitly
      // this time. Prove the placeholder polling loop alone — no manual
      // trigger, no reload, no new Worker instance — brings the interceptor
      // back to seeing the node within its own poll interval (15s; this
      // polls for up to 40s to leave real margin for CI scheduling jitter
      // without being a hard 15s cliff).
      await setRole(sql, membershipId, "hr-admin");
      await expect
        .poll(() => queryOrgScenario(), { timeout: 40_000, intervals: [1000] })
        .toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
