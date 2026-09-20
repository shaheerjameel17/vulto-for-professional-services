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
 * FDN-68 Stage 1: AuditEntry containment through the real local graph stack.
 *
 * Real Chromium drives the production graph client and Worker protocol into
 * `LocalGraphWorkerRuntime.mutate`, backed by the real online-unlocked sealed
 * store, Loro WASM, SQLite-WASM, and Postgres membership. The only unchecked
 * write is the test seed needed to make alter/remove meaningful; all three
 * forbidden operations and the ordinary control mutation use `mutate`.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit containment 68!";

interface NodeGetResult {
  kind: string;
  node?: {
    nodeId: string;
    nodeType: string;
    fragments: { partitionKey: string; record: Record<string, unknown> }[];
  } | null;
}

interface AuditMutationDiagnosticsApi {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  applyDeltaBatch(
    base64Snapshots: readonly string[],
  ): Promise<{ mergedDeltaCount: number }>;
  mutate(
    base64Snapshots: readonly string[],
  ): Promise<{ status: string; reason?: string; thrown?: string }>;
  query(graphQuery: unknown): Promise<NodeGetResult>;
  auditGenericMutation: {
    buildSnapshots(workspaceId: string): {
      seed: string;
      create: string;
      alter: string;
      remove: string;
      typeChange: string;
      permittedSkillCreate: string;
    };
    existingAuditId: string;
    createdAuditId: string;
    skillId: string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: AuditMutationDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Containment Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

async function createWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
  role: "owner" | "hr-admin",
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Audit Containment Co', ${`audit-containment-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function openDiagnostics(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    await api.initialize();
  });
}

async function runContainmentProof(page: Page, workspaceId: string) {
  await openDiagnostics(page, workspaceId);
  const attempted = await page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    const snapshots = api.auditGenericMutation.buildSnapshots(id);
    await api.applyDeltaBatch([snapshots.seed]);

    const create = await api.mutate([snapshots.create]);
    const alter = await api.mutate([snapshots.alter]);
    const remove = await api.mutate([snapshots.remove]);
    const permitted = await api.mutate([snapshots.permittedSkillCreate]);

    const query = (nodeId: string, nodeType: "AuditEntry" | "Skill") =>
      api.query({
        kind: "node-get",
        nodeId,
        nodeType,
        includeSoftDeleted: false,
      });
    const beforeReopen = {
      existing: await query(api.auditGenericMutation.existingAuditId, "AuditEntry"),
      created: await query(api.auditGenericMutation.createdAuditId, "AuditEntry"),
      skill: await query(api.auditGenericMutation.skillId, "Skill"),
    };
    const ids = {
      existing: api.auditGenericMutation.existingAuditId,
      created: api.auditGenericMutation.createdAuditId,
      skill: api.auditGenericMutation.skillId,
    };
    await api.dispose();
    return { create, alter, remove, permitted, beforeReopen, ids };
  }, workspaceId);

  await openDiagnostics(page, workspaceId);
  const afterReopen = await page.evaluate(async (ids) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing after reopen");
    const query = (nodeId: string, nodeType: "AuditEntry" | "Skill") =>
      api.query({
        kind: "node-get",
        nodeId,
        nodeType,
        includeSoftDeleted: false,
      });
    return {
      existing: await query(ids.existing, "AuditEntry"),
      created: await query(ids.created, "AuditEntry"),
      skill: await query(ids.skill, "Skill"),
    };
  }, attempted.ids);

  return { ...attempted, afterReopen };
}

function eventType(result: NodeGetResult): unknown {
  return result.node?.fragments[0]?.record.event_type;
}

function assertContained(result: Awaited<ReturnType<typeof runContainmentProof>>) {
  for (const outcome of [result.create, result.alter, result.remove]) {
    expect(outcome.status).toBe("unsupported");
    expect(outcome.reason).toContain("AuditEntry");
    expect(outcome.reason).toContain("generic mutation");
  }
  expect(result.permitted.status).toBe("applied");

  expect(eventType(result.beforeReopen.existing)).toBe("PermissionDenied");
  expect(result.beforeReopen.created.node).toBeNull();
  expect(result.beforeReopen.skill.node?.nodeId).toBe(result.ids.skill);

  expect(eventType(result.afterReopen.existing)).toBe("PermissionDenied");
  expect(result.afterReopen.created.node).toBeNull();
  expect(result.afterReopen.skill.node?.nodeId).toBe(result.ids.skill);
}

test.describe.configure({ mode: "serial" });

let sharedAccount: { userId: string; cookies: Cookie[] } | undefined;

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

test.describe("FDN-68 Stage 1 AuditEntry generic-mutation containment", () => {
  for (const role of ["owner", "hr-admin"] as const) {
    const roleName = role === "owner" ? "Owner" : "HR Admin";
    test(`${roleName} is refused on AuditEntry create, alter, and remove while an ordinary permitted mutation commits and survives reopen`, async ({
      browser,
    }) => {
      const sql = postgres(databaseUrl, { max: 1 });
      let context: BrowserContext | undefined;
      try {
        if (!sharedAccount) throw new Error("shared account was not created");
        context = await browser.newContext({ ignoreHTTPSErrors: true });
        await context.addCookies(sharedAccount.cookies);
        const page = await context.newPage();
        const workspaceId = await createWorkspaceMembership(
          sql,
          sharedAccount.userId,
          role,
        );
        assertContained(await runContainmentProof(page, workspaceId));
      } finally {
        await context?.close();
        await sql.end();
      }
    });
  }

  test("Owner is refused when an existing AuditEntry fragment changes node_type to Skill", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addCookies(sharedAccount.cookies);
      const page = await context.newPage();
      const workspaceId = await createWorkspaceMembership(
        sql,
        sharedAccount.userId,
        "owner",
      );
      await openDiagnostics(page, workspaceId);

      const result = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshots = api.auditGenericMutation.buildSnapshots(id);
        await api.applyDeltaBatch([snapshots.seed]);
        const outcome = await api.mutate([snapshots.typeChange]);
        const unchanged = await api.query({
          kind: "node-get",
          nodeId: api.auditGenericMutation.existingAuditId,
          nodeType: "AuditEntry",
          includeSoftDeleted: false,
        });
        return { outcome, unchanged };
      }, workspaceId);

      expect(result.outcome.status).toBe("unsupported");
      expect(result.outcome.reason).toContain("AuditEntry");
      expect(result.outcome.reason).toContain("generic mutation");
      expect(result.unchanged.node?.nodeType).toBe("AuditEntry");
      expect(eventType(result.unchanged)).toBe("PermissionDenied");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
