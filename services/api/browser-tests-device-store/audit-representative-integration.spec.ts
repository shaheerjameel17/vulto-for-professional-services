import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit integration 68!";
const projectionOccurredAt = "2026-09-11T10:00:00.000Z";

type Body = Record<string, unknown>;
type AuditEntry = {
  audit_entry_id: string;
  event_type: string;
  operation: string;
  outcome: string;
  actor_user_id: string;
  actor_membership_id: string;
  actor_role: string | null;
  actor_roles: string[];
  actor_application: string;
  target: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurred_at: string;
};
type AuditPage = {
  kind: string;
  source?: string;
  entries?: AuditEntry[];
};

interface DiagnosticsApi {
  initialize(): Promise<void>;
  applyDeltaBatch(snapshots: readonly string[]): Promise<unknown>;
  query(query: Record<string, unknown>): Promise<{
    kind: string;
    node: { fragments: Array<{ partitionKey: string; record: Body }> } | null;
  }>;
  auditLog: {
    query(workspaceId: string, filters?: Body): Promise<AuditPage>;
  };
  permissionProof: {
    employeeId: string;
    buildEmployeeFragments(workspaceId: string): string;
  };
  createAuditLocalJournalProof(): {
    open(workspaceId: string): Promise<unknown>;
    flushOutbox(): Promise<{ journal: AuditEntry[]; outbox: AuditEntry[] }>;
    dispose(): Promise<void>;
  };
  workspaceProjection: {
    deviceId(): Promise<{ deviceId: string }>;
    runFounding(message: Body): Promise<{ outboxEntry: Body }>;
    runTransitionCommitFailure(message: Body): Promise<{
      error: string;
      journal: AuditEntry[];
    }>;
    queryAudit(
      workspaceId: string,
      application: "VultoProjects",
    ): Promise<{
      context: Body;
      afterFlush: { journal: AuditEntry[]; outbox: AuditEntry[] };
      query: AuditPage;
    }>;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: DiagnosticsApi;
    __auditRepresentativeProof?: ReturnType<
      DiagnosticsApi["createAuditLocalJournalProof"]
    >;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{
  userId: string;
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
}> {
  const email = `browser-fdn68-integration-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Integration Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [account] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}`;
  if (!account) throw new Error("sign-up did not create the audit owner");
  return {
    userId: account.id,
    cookies: await page.context().cookies(apiOrigin),
  };
}

async function apiPost(page: Page, route: string, body: Body) {
  return page.evaluate(
    async ({ origin, routePath, requestBody }) => {
      const response = await fetch(`${origin}${routePath}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    { origin: apiOrigin, routePath: route, requestBody: body },
  );
}

async function openHarness(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.waitForFunction(
    () => window.__vultoGraphPersistenceDiagnostics !== undefined,
    undefined,
    { timeout: 20_000 },
  );
}

async function projection<T>(
  page: Page,
  method: "deviceId" | "runFounding" | "runTransitionCommitFailure" | "queryAudit",
  args: unknown[] = [],
): Promise<T> {
  return page.evaluate(
    async ({ methodName, methodArgs }) => {
      const projectionApi =
        window.__vultoGraphPersistenceDiagnostics?.workspaceProjection;
      if (!projectionApi) throw new Error("projection diagnostics API missing");
      if (methodName === "deviceId") return projectionApi.deviceId();
      if (methodName === "runFounding") {
        return projectionApi.runFounding(methodArgs[0] as Body);
      }
      if (methodName === "runTransitionCommitFailure") {
        return projectionApi.runTransitionCommitFailure(methodArgs[0] as Body);
      }
      return projectionApi.queryAudit(
        methodArgs[0] as string,
        methodArgs[1] as "VultoProjects",
      );
    },
    { methodName: method, methodArgs: args },
  ) as Promise<T>;
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await resetRateLimits(sql);
  } finally {
    await sql.end();
  }
});

test("Foundation projection and Roster compensation access share the canonical audit path without feature writers", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1 });
  let foundationContext: BrowserContext | undefined;
  let rosterContext: BrowserContext | undefined;
  try {
    foundationContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const foundationPage = await foundationContext.newPage();
    const account = await signUp(foundationPage, sql);
    await foundationContext.addCookies(account.cookies);
    await openHarness(foundationPage, "fdn-68-foundation-harness");

    const { deviceId } = await projection<{ deviceId: string }>(
      foundationPage,
      "deviceId",
    );
    const registered = await apiPost(foundationPage, "/devices/register", {
      deviceId,
      deviceName: "Foundation projection proof",
      platform: "web",
      application: "VultoProjects",
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);

    const created = await apiPost(foundationPage, "/workspace/create", {
      workspaceName: "Representative Integration",
      deviceId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const grant = created.body as Body;
    expect(grant.application).toBe("VultoProjects");

    const consumedResponse = await apiPost(
      foundationPage,
      "/workspace/consume-projection-grant",
      {
        grant: grant.grant,
        workspaceId: grant.workspaceId,
        membershipId: grant.membershipId,
        deviceId,
      },
    );
    expect(consumedResponse.status, JSON.stringify(consumedResponse.body)).toBe(200);
    const consumed = consumedResponse.body as Body;
    expect(consumed).toMatchObject({
      userId: account.userId,
      application: "VultoProjects",
      roles: ["owner"],
    });

    const foundingMessage = {
      consumed,
      serverHalf: grant.serverHalf,
      keyEpoch: grant.keyEpoch,
      workspaceName: "Representative Integration",
      occurredAt: projectionOccurredAt,
    };
    const firstProjection = await projection<{ outboxEntry: Body }>(
      foundationPage,
      "runFounding",
      [foundingMessage],
    );
    const replayedProjection = await projection<{ outboxEntry: Body }>(
      foundationPage,
      "runFounding",
      [foundingMessage],
    );
    expect(firstProjection.outboxEntry).toMatchObject({
      kind: "admission",
      committedLocally: true,
      confirmed: false,
    });
    expect(replayedProjection.outboxEntry).toEqual(firstProjection.outboxEntry);
    expect(firstProjection.outboxEntry).not.toHaveProperty("authorizationPath");

    const confirmed = await apiPost(foundationPage, "/workspace/confirm-projection", {
      workspaceId: grant.workspaceId,
      membershipId: grant.membershipId,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const foundationEvidence = await projection<{
      context: Body;
      afterFlush: { journal: AuditEntry[]; outbox: AuditEntry[] };
      query: AuditPage;
    }>(foundationPage, "queryAudit", [String(grant.workspaceId), "VultoProjects"]);
    expect(foundationEvidence.context).toMatchObject({
      userId: account.userId,
      application: "VultoProjects",
      roles: ["owner"],
    });
    expect(foundationEvidence.afterFlush.outbox).toEqual([]);
    const projectionEntries = foundationEvidence.afterFlush.journal.filter(
      (entry) => entry.event_type === "PrivilegedProjectionAuthorized",
    );
    expect(projectionEntries).toHaveLength(1);
    expect(projectionEntries[0]).toMatchObject({
      event_type: "PrivilegedProjectionAuthorized",
      operation: "NodeCreate",
      outcome: "Granted",
      actor_user_id: account.userId,
      actor_membership_id: grant.membershipId,
      actor_role: null,
      actor_roles: ["owner"],
      actor_application: "VultoProjects",
      target: {
        kind: "NodeTarget",
        node_type: "WorkspaceMembership",
        node_id: grant.membershipId,
        partition_key: "record",
        target_tier: 0,
      },
      metadata: {
        authorization_path: "PrivilegedProjectionException",
        projection_kind: "Admission",
        result_cardinality: "Single",
      },
      occurred_at: projectionOccurredAt,
    });
    expect(foundationEvidence.query).toMatchObject({
      kind: "audit-log-page",
      source: "Local",
    });
    expect(foundationEvidence.query.entries).toHaveLength(1);

    const failedProjectionOccurredAt = "2026-09-11T10:01:00.000Z";
    const failedProjection = await projection<{
      error: string;
      journal: AuditEntry[];
    }>(foundationPage, "runTransitionCommitFailure", [
      {
        workspaceId: grant.workspaceId,
        membershipId: grant.membershipId,
        application: "VultoProjects",
        actorUserId: account.userId,
        occurredAt: failedProjectionOccurredAt,
      },
    ]);
    expect(failedProjection.error).toContain(
      "StructurallyInvalid is not a registered lifecycle status for WorkspaceMembership",
    );
    const failedProjectionEntries = failedProjection.journal.filter(
      (entry) => entry.occurred_at >= failedProjectionOccurredAt,
    );
    expect(failedProjectionEntries).toHaveLength(2);
    expect(failedProjectionEntries[0]).toMatchObject({
      event_type: "PrivilegedProjectionAuthorized",
      operation: "NodeUpdate",
      outcome: "Granted",
      actor_role: null,
      actor_application: "VultoProjects",
      target: {
        kind: "NodeTarget",
        node_type: "WorkspaceMembership",
        node_id: grant.membershipId,
        partition_key: "record",
        target_tier: 0,
      },
      metadata: {
        authorization_path: "PrivilegedProjectionException",
        projection_kind: "RoleChange",
        result_cardinality: "Single",
      },
      occurred_at: failedProjectionOccurredAt,
    });
    expect(failedProjectionEntries[1]).toMatchObject({
      event_type: "AuthorizedOperationFailed",
      operation: "NodeUpdate",
      outcome: "Failed",
      actor_role: null,
      actor_application: "VultoProjects",
      target: failedProjectionEntries[0]!.target,
      metadata: {
        failure_class: "CommitFailed",
        result_cardinality: "Single",
      },
    });
    expect(failedProjectionEntries[1]!.metadata).not.toHaveProperty(
      "authorization_path",
    );
    expect(failedProjectionEntries[1]!.metadata).not.toHaveProperty("projection_kind");
    expect(JSON.stringify(failedProjectionEntries)).not.toContain(
      failedProjection.error,
    );

    rosterContext = await browser.newContext({ ignoreHTTPSErrors: true });
    await rosterContext.addCookies(account.cookies);
    const rosterPage = await rosterContext.newPage();
    await openHarness(rosterPage, String(grant.workspaceId));
    await rosterPage.getByRole("button", { name: "Retry" }).click();
    await expect(rosterPage.getByTestId("graph-persistence-unlocked")).toBeVisible({
      timeout: 20_000,
    });
    await rosterPage.evaluate(async () => {
      await window.__vultoGraphPersistenceDiagnostics!.initialize();
    });

    const employeeId = await rosterPage.evaluate(async (workspaceId) => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      await api.applyDeltaBatch([
        api.permissionProof.buildEmployeeFragments(workspaceId),
      ]);
      return api.permissionProof.employeeId;
    }, String(grant.workspaceId));
    const employee = await rosterPage.evaluate(async (nodeId) => {
      return window.__vultoGraphPersistenceDiagnostics!.query({
        kind: "node-get",
        nodeType: "Employee",
        nodeId,
        includeSoftDeleted: false,
      });
    }, employeeId);
    expect(employee.kind).toBe("node-get");
    const compensation = employee.node?.fragments.find(
      (fragment) => fragment.partitionKey === "compensation",
    );
    expect(compensation?.record.base_salary).toBe(175000);

    const rosterAudit = await rosterPage.evaluate(async (workspaceId) => {
      return window.__vultoGraphPersistenceDiagnostics!.auditLog.query(workspaceId, {
        eventType: "SensitiveAccessGranted",
        targetNodeType: "Employee",
        limit: 50,
      });
    }, String(grant.workspaceId));
    expect(rosterAudit).toMatchObject({ kind: "audit-log-page", source: "Local" });
    const rosterEntries = rosterAudit.entries ?? [];
    expect(rosterEntries).toHaveLength(1);
    expect(rosterEntries[0]).toMatchObject({
      event_type: "SensitiveAccessGranted",
      operation: "NodeRead",
      outcome: "Granted",
      actor_user_id: account.userId,
      actor_membership_id: grant.membershipId,
      actor_role: "owner",
      actor_roles: ["owner"],
      actor_application: "VultoRoster",
      target: {
        kind: "NodeTarget",
        node_type: "Employee",
        node_id: employeeId,
        partition_key: "compensation",
        target_tier: 1,
      },
    });

    await rosterPage.evaluate(async (workspaceId) => {
      const proof =
        window.__vultoGraphPersistenceDiagnostics!.createAuditLocalJournalProof();
      window.__auditRepresentativeProof = proof;
      await proof.open(workspaceId);
    }, String(grant.workspaceId));
    const rosterFlushed = await rosterPage.evaluate(() =>
      window.__auditRepresentativeProof!.flushOutbox(),
    );
    await rosterPage.evaluate(async () => {
      await window.__auditRepresentativeProof!.dispose();
      delete window.__auditRepresentativeProof;
    });
    expect(rosterFlushed.outbox).toEqual([]);

    const serverRows = await sql<{ entry: AuditEntry }[]>`
      select "entry" from "audit_journal"
      where "workspace_id" = ${String(grant.workspaceId)}::uuid
        and "event_type" in (
          'PrivilegedProjectionAuthorized', 'SensitiveAccessGranted'
        )
      order by "event_type"`;
    expect(serverRows.map((row) => row.entry.event_type)).toEqual([
      "PrivilegedProjectionAuthorized",
      "SensitiveAccessGranted",
    ]);
    expect(serverRows.map((row) => row.entry.actor_application).sort()).toEqual([
      "VultoProjects",
      "VultoRoster",
    ]);
    expect(
      serverRows.filter(
        (row) => row.entry.event_type === "PrivilegedProjectionAuthorized",
      ),
    ).toHaveLength(1);

    const repositoryRoot = path.resolve(process.cwd(), "../..");
    const featureBoundarySources = await Promise.all(
      [
        "packages/graph/src/worker/workspace-projection.ts",
        "packages/graph/src/worker/workspace-projection-delta.ts",
        "packages/graph/src/worker/workspace-projection-runner.ts",
        "packages/graph/src/worker/testing/permission-proof.ts",
      ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
    );
    for (const source of featureBoundarySources) {
      expect(source).not.toContain("new AuditRecorder");
      expect(source).not.toContain(".record(");
    }
  } finally {
    await foundationContext?.close();
    await rosterContext?.close();
    await sql.end();
  }
});
