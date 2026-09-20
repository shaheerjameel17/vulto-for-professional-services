import { expect, test, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit local query 68!";

interface AuditEntryView {
  audit_entry_id: string;
  event_type: string;
  operation: string;
  outcome: string;
  target: Record<string, unknown>;
}

type AuditQueryResult =
  | {
      kind: "audit-log-page";
      entries: AuditEntryView[];
      nextCursor?: string;
      source: "Local";
    }
  | { kind: "audit-log-denied"; reason: string }
  | {
      kind: "audit-log-retention-window-unavailable";
      availableFrom: string;
    };

interface DiagnosticsApi {
  initialize(): Promise<void>;
  applyDeltaBatch(snapshots: readonly string[]): Promise<unknown>;
  query(query: Record<string, unknown>): Promise<Record<string, unknown>>;
  refreshRole(): Promise<string[]>;
  auditLog: {
    query(
      workspaceId: string,
      filters?: Record<string, unknown>,
    ): Promise<AuditQueryResult>;
  };
  auditLocalQueryProof: {
    buildSeed(workspaceId: string): string;
    tier1NodeId: string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: DiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-query-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Query Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}
  `;
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

async function unlockAndInitialize(page: Page): Promise<void> {
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

async function auditQuery(
  page: Page,
  workspaceId: string,
  filters: Record<string, unknown> = {},
): Promise<AuditQueryResult> {
  return page.evaluate(
    async ({ targetWorkspaceId, queryFilters }) => {
      const api = window.__vultoGraphPersistenceDiagnostics;
      if (!api) throw new Error("diagnostics API missing");
      return api.auditLog.query(targetWorkspaceId, queryFilters);
    },
    { targetWorkspaceId: workspaceId, queryFilters: filters },
  );
}

test("AuditLog.query authorizes, pages, preserves opaque targets, survives reopen, and reports unavailable history on the real stack", async ({
  browser,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const bootstrap = await browser.newContext({ ignoreHTTPSErrors: true });
  const bootstrapPage = await bootstrap.newPage();
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await resetRateLimits(sql);
    const account = await signUp(bootstrapPage, sql);
    await bootstrap.close();

    const workspaceId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const otherMembershipId = crypto.randomUUID();
    await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
      values (${workspaceId}, 'Audit Query Co', ${`audit-query-${workspaceId}`}, now(), 'active')`;
    await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
      values (${membershipId}, ${workspaceId}, ${account.userId}, 'team-member', now(), 'active', 'confirmed')`;
    await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
      values (${otherWorkspaceId}, 'Other Audit Query Co', ${`audit-query-other-${otherWorkspaceId}`}, now(), 'active')`;
    await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
      values (${otherMembershipId}, ${otherWorkspaceId}, ${account.userId}, 'hr-admin', now(), 'active', 'confirmed')`;

    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(account.cookies);
    const page = await context.newPage();
    await page.goto(
      `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
    );
    await unlockAndInitialize(page);

    const tier1NodeId = await page.evaluate(async (targetWorkspaceId) => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      await api.applyDeltaBatch([
        api.auditLocalQueryProof.buildSeed(targetWorkspaceId),
      ]);
      const denied = await api.query({
        kind: "node-get",
        nodeType: "RateCard",
        nodeId: api.auditLocalQueryProof.tier1NodeId,
        includeSoftDeleted: false,
      });
      if (denied.kind !== "node-get" || denied.node !== null) {
        throw new Error("Team Member Tier 1 seed query was not denied");
      }
      return api.auditLocalQueryProof.tier1NodeId;
    }, workspaceId);

    const teamMemberDenial = await auditQuery(page, workspaceId, {
      eventType: "PermissionDenied",
      limit: 10,
    });

    await sql`update "member" set "role" = 'finance-admin' where "id" = ${membershipId}`;
    await expect(
      page.evaluate(() => window.__vultoGraphPersistenceDiagnostics!.refreshRole()),
    ).resolves.toEqual(["finance-admin"]);
    const financeAdminDenial = await auditQuery(page, workspaceId, {
      eventType: "AuthorizedOperationFailed",
      limit: 10,
    });

    expect(teamMemberDenial).toEqual({
      kind: "audit-log-denied",
      reason: "Audit log access is not available",
    });
    expect(financeAdminDenial).toEqual(teamMemberDenial);

    await sql`update "member" set "role" = 'owner' where "id" = ${membershipId}`;
    await expect(
      page.evaluate(() => window.__vultoGraphPersistenceDiagnostics!.refreshRole()),
    ).resolves.toEqual(["owner"]);

    const sensitiveRecord = await page.evaluate(async (nodeId) => {
      const result = await window.__vultoGraphPersistenceDiagnostics!.query({
        kind: "node-get",
        nodeType: "RateCard",
        nodeId,
        includeSoftDeleted: false,
      });
      return result;
    }, tier1NodeId);
    expect(JSON.stringify(sensitiveRecord)).toContain("98765");

    const firstPage = await auditQuery(page, workspaceId, { limit: 2 });
    expect(firstPage.kind).toBe("audit-log-page");
    if (firstPage.kind !== "audit-log-page") throw new Error("page unavailable");
    expect(firstPage.source).toBe("Local");
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.nextCursor).not.toContain(workspaceId);

    const allBeforeAuthorizedQuery = await auditQuery(page, workspaceId, {
      limit: 50,
    });
    expect(allBeforeAuthorizedQuery.kind).toBe("audit-log-page");
    if (allBeforeAuthorizedQuery.kind !== "audit-log-page") {
      throw new Error("local audit page unavailable");
    }
    expect(allBeforeAuthorizedQuery.entries).toHaveLength(4);
    expect(
      allBeforeAuthorizedQuery.entries.filter(
        (entry) =>
          entry.event_type === "PermissionDenied" &&
          entry.operation === "NodeList" &&
          entry.target.kind === "QueryTarget" &&
          entry.target.requested_node_type === "AuditEntry",
      ),
    ).toHaveLength(2);

    const sensitiveAuditEntry = allBeforeAuthorizedQuery.entries.find(
      (entry) =>
        entry.event_type === "SensitiveAccessGranted" &&
        entry.target.kind === "NodeTarget" &&
        entry.target.node_id === tier1NodeId,
    );
    expect(sensitiveAuditEntry?.target).toEqual({
      kind: "NodeTarget",
      node_type: "RateCard",
      node_id: tier1NodeId,
      partition_key: "record",
      target_tier: 1,
    });
    expect(JSON.stringify(sensitiveAuditEntry)).not.toContain("98765");

    const allAfterAuthorizedQuery = await auditQuery(page, workspaceId, {
      limit: 50,
    });
    expect(allAfterAuthorizedQuery).toMatchObject({
      kind: "audit-log-page",
      source: "Local",
      entries: allBeforeAuthorizedQuery.entries,
    });

    const secondPageAsOwner = await auditQuery(page, workspaceId, {
      cursor: firstPage.nextCursor!,
      limit: 2,
    });
    expect(secondPageAsOwner).toMatchObject({
      kind: "audit-log-page",
      source: "Local",
    });
    if (secondPageAsOwner.kind !== "audit-log-page") {
      throw new Error("second page unavailable");
    }
    expect(secondPageAsOwner.entries).toHaveLength(2);
    expect(secondPageAsOwner.nextCursor).toBeDefined();
    const emptyHistoricalPage = await auditQuery(page, workspaceId, {
      cursor: secondPageAsOwner.nextCursor!,
      limit: 2,
    });
    expect(emptyHistoricalPage).toEqual({
      kind: "audit-log-page",
      entries: [],
      source: "Historical",
    });

    await sql`update "member" set "role" = 'hr-admin' where "id" = ${membershipId}`;
    await expect(
      page.evaluate(() => window.__vultoGraphPersistenceDiagnostics!.refreshRole()),
    ).resolves.toEqual(["hr-admin"]);
    const secondPageAsHrAdmin = await auditQuery(page, workspaceId, {
      cursor: firstPage.nextCursor!,
      limit: 2,
    });
    expect(secondPageAsHrAdmin).toMatchObject({
      kind: "audit-log-page",
      source: "Local",
      entries: secondPageAsOwner.entries,
    });
    if (secondPageAsHrAdmin.kind !== "audit-log-page") {
      throw new Error("HR Admin second page unavailable");
    }
    expect(secondPageAsHrAdmin.nextCursor).toBeDefined();

    const unavailable = await auditQuery(page, workspaceId, {
      startDate: "2020-01-01T00:00:00.000Z",
      endDate: "2020-12-31T23:59:59.999Z",
      limit: 10,
    });
    expect(unavailable).toEqual({
      kind: "audit-log-page",
      entries: [],
      source: "Historical",
    });

    await page.reload();
    await unlockAndInitialize(page);
    const reopenedSecondPage = await auditQuery(page, workspaceId, {
      cursor: firstPage.nextCursor!,
      limit: 2,
    });
    expect(reopenedSecondPage).toMatchObject({
      kind: "audit-log-page",
      source: "Local",
      entries: secondPageAsOwner.entries,
    });
    if (reopenedSecondPage.kind !== "audit-log-page") {
      throw new Error("reopened second page unavailable");
    }
    expect(reopenedSecondPage.nextCursor).toBeDefined();

    const otherWorkspacePage = await context.newPage();
    await otherWorkspacePage.goto(
      `${webOrigin}/graph-persistence-diagnostics?workspaceId=${otherWorkspaceId}`,
    );
    await unlockAndInitialize(otherWorkspacePage);
    const foreignCursorResult = await auditQuery(otherWorkspacePage, otherWorkspaceId, {
      cursor: firstPage.nextCursor!,
      limit: 2,
    });
    expect(foreignCursorResult).toMatchObject({
      kind: "audit-log-retention-window-unavailable",
    });
  } finally {
    await context?.close().catch(() => {});
    await bootstrap.close().catch(() => {});
    await sql.end();
  }
});
