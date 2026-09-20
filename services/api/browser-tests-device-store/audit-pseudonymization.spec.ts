import { expect, test, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";

import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit pseudonym 68!";

interface AuditEntryView {
  audit_entry_id: string;
  workspace_id: string;
  event_type: string;
  operation: string;
  outcome: string;
  actor_user_id: string;
  actor_membership_id: string;
  actor_application: string;
  occurred_at: string;
  target: Record<string, unknown>;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

interface AuditDatabaseRow {
  entry: AuditEntryView;
  audit_entry_id: string;
  content_digest: string;
  occurred_at: string;
  actor_user_id: string;
  event_type: string;
  operation: string;
  outcome: string;
  target_kind: string;
  target_node_type: string | null;
  target_tier: number | null;
  appended_at: string;
}

interface AuditSnapshot {
  journal: AuditEntryView[];
  outbox: AuditEntryView[];
}

type AuditQueryResult =
  | {
      kind: "audit-log-page";
      entries: AuditEntryView[];
      nextCursor?: string;
      source: "Local" | "Historical";
    }
  | { kind: "audit-log-denied"; reason: string }
  | { kind: "audit-log-retention-window-unavailable"; availableFrom: string };

interface ProofHandle {
  open(workspaceId: string): Promise<unknown>;
  snapshot(): Promise<AuditSnapshot>;
  flushOutbox(): Promise<AuditSnapshot>;
  pseudonymizeActor(
    workspaceId: string,
    currentActorUserId: string,
    opaqueActorToken: string,
  ): Promise<{ serverEntryIds: string[]; localEntryIds: string[] }>;
  recreate(workspaceId: string): Promise<unknown>;
  dispose(): Promise<void>;
}

interface DiagnosticsApi {
  initialize(): Promise<void>;
  applyDeltaBatch(snapshots: readonly string[]): Promise<unknown>;
  query(query: Record<string, unknown>): Promise<Record<string, unknown>>;
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
  createAuditLocalJournalProof(): ProofHandle;
  startSync(): Promise<void>;
  stopSync(): Promise<void>;
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: DiagnosticsApi;
    __auditPseudonymizationProof?: ProofHandle;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-pseudonym-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Pseudonymization Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}
  `;
  if (!user) throw new Error("sign-up did not create the audit owner");
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

async function createWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<{ workspaceId: string; membershipId: string }> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Audit Pseudonymization', ${`audit-pseudonym-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return { workspaceId, membershipId };
}

async function unlockAndInitialize(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics!;
    await api.initialize();
    window.__auditPseudonymizationProof = api.createAuditLocalJournalProof();
  });
  await page.evaluate(
    (id) => window.__auditPseudonymizationProof!.open(id),
    workspaceId,
  );
}

async function apiRequest(
  page: Page,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ target, payload }) => {
      const response = await fetch(target, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { target: `${apiOrigin}${path}`, payload: body },
  );
}

async function readRows(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
): Promise<AuditDatabaseRow[]> {
  return sql<AuditDatabaseRow[]>`
    select
      "entry", "audit_entry_id"::text, "content_digest",
      "occurred_at"::text, "actor_user_id"::text, "event_type", "operation",
      "outcome", "target_kind", "target_node_type", "target_tier",
      "appended_at"::text
    from "audit_journal"
    where "workspace_id" = ${workspaceId}::uuid
    order by "audit_entry_id"
  `;
}

function withoutActor(entry: AuditEntryView): Record<string, unknown> {
  const { actor_user_id: _actorUserId, ...immutable } = entry;
  return immutable;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function queryAllLocal(
  page: Page,
  workspaceId: string,
): Promise<AuditEntryView[]> {
  const result = await page.evaluate(
    (id) => window.__vultoGraphPersistenceDiagnostics!.auditLog.query(id),
    workspaceId,
  );
  if (result.kind !== "audit-log-page" || result.source !== "Local") {
    throw new Error("Local audit projection was unavailable");
  }
  return result.entries;
}

test("audit actor pseudonymization changes only actor_user_id and remains idempotent across server and sealed projections", async ({
  browser,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const signupContext = await browser.newContext({ ignoreHTTPSErrors: true });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await resetRateLimits(sql);
    const account = await signUp(await signupContext.newPage(), sql);
    const workspace = await createWorkspace(sql, account.userId);
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(account.cookies);
    const page = await context.newPage();
    await unlockAndInitialize(page, workspace.workspaceId);

    await page.evaluate(async (workspaceId) => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      await api.applyDeltaBatch([api.auditLocalQueryProof.buildSeed(workspaceId)]);
      await api.startSync();
      for (let index = 0; index < 3; index += 1) {
        const result = await api.query({
          kind: "node-get",
          nodeType: "RateCard",
          nodeId: api.auditLocalQueryProof.tier1NodeId,
          includeSoftDeleted: false,
        });
        if (result.kind !== "node-get" || result.node === null) {
          throw new Error("Tier 1 production query did not complete");
        }
      }
    }, workspace.workspaceId);

    await page.evaluate(() => window.__auditPseudonymizationProof!.flushOutbox());
    await expect
      .poll(async () => (await readRows(sql, workspace.workspaceId)).length)
      .toBe(3);

    const beforeRows = await readRows(sql, workspace.workspaceId);
    const beforeLocal = await queryAllLocal(page, workspace.workspaceId);
    const canonicalBeforeById = new Map(
      beforeRows.map((row) => [
        row.audit_entry_id,
        canonicalJson(withoutActor(row.entry)),
      ]),
    );
    expect(beforeLocal).toHaveLength(3);
    expect(beforeRows.every((row) => row.actor_user_id === account.userId)).toBe(true);
    expect(beforeRows.every((row) => row.entry.actor_user_id === account.userId)).toBe(
      true,
    );

    const [device] = await sql<{ id: string }[]>`
      select "id" from "device" where "user_id" = ${account.userId}
      order by "registered_at" desc limit 1
    `;
    if (!device) throw new Error("authenticated device was not registered");
    const opaqueActorToken = crypto.randomUUID();
    const command = {
      workspaceId: workspace.workspaceId,
      deviceId: device.id,
      currentActorUserId: account.userId,
      opaqueActorToken,
    };
    const firstResult = await page.evaluate(
      ({ workspaceId, currentActorUserId, opaqueActorToken }) =>
        window.__auditPseudonymizationProof!.pseudonymizeActor(
          workspaceId,
          currentActorUserId,
          opaqueActorToken,
        ),
      command,
    );
    expect(new Set(firstResult.serverEntryIds)).toEqual(
      new Set(beforeRows.map((row) => row.audit_entry_id)),
    );
    expect(new Set(firstResult.localEntryIds)).toEqual(
      new Set(beforeRows.map((row) => row.audit_entry_id)),
    );

    const afterRows = await readRows(sql, workspace.workspaceId);
    const afterLocal = await queryAllLocal(page, workspace.workspaceId);
    expect(afterRows).toHaveLength(beforeRows.length);
    expect(afterLocal).toHaveLength(beforeLocal.length);
    for (const before of beforeRows) {
      const after = afterRows.find(
        (candidate) => candidate.audit_entry_id === before.audit_entry_id,
      );
      expect(after).toBeDefined();
      expect(after!.actor_user_id).toBe(opaqueActorToken);
      expect(after!.entry.actor_user_id).toBe(opaqueActorToken);
      expect(withoutActor(after!.entry)).toEqual(withoutActor(before.entry));
      expect(canonicalJson(withoutActor(after!.entry))).toBe(
        canonicalBeforeById.get(before.audit_entry_id),
      );
      expect({
        audit_entry_id: after!.audit_entry_id,
        occurred_at: after!.occurred_at,
        event_type: after!.event_type,
        operation: after!.operation,
        outcome: after!.outcome,
        target_kind: after!.target_kind,
        target_node_type: after!.target_node_type,
        target_tier: after!.target_tier,
        appended_at: after!.appended_at,
      }).toEqual({
        audit_entry_id: before.audit_entry_id,
        occurred_at: before.occurred_at,
        event_type: before.event_type,
        operation: before.operation,
        outcome: before.outcome,
        target_kind: before.target_kind,
        target_node_type: before.target_node_type,
        target_tier: before.target_tier,
        appended_at: before.appended_at,
      });
      expect(after!.content_digest).not.toBe(before.content_digest);
    }
    expect(afterLocal.every((entry) => entry.actor_user_id === opaqueActorToken)).toBe(
      true,
    );
    for (const entry of afterLocal) {
      expect(canonicalJson(withoutActor(entry))).toBe(
        canonicalBeforeById.get(entry.audit_entry_id),
      );
    }
    expect(JSON.stringify(afterRows)).not.toContain(account.userId);
    expect(JSON.stringify(afterLocal)).not.toContain(account.userId);

    for (const forbiddenField of [
      "event_type",
      "operation",
      "target",
      "outcome",
      "occurred_at",
      "metadata",
    ]) {
      const refused = await apiRequest(page, "/audit/pseudonymize-actor", {
        ...command,
        [forbiddenField]: beforeRows[0]!.entry[forbiddenField],
      });
      expect(refused.status).toBe(400);
    }
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      expect(
        (
          await page.request.fetch(`${apiOrigin}/audit/pseudonymize-actor`, {
            method,
            data: {},
          })
        ).status(),
      ).toBe(404);
    }
    expect(await readRows(sql, workspace.workspaceId)).toEqual(afterRows);

    const replayResult = await page.evaluate(
      ({ workspaceId, currentActorUserId, opaqueActorToken }) =>
        window.__auditPseudonymizationProof!.pseudonymizeActor(
          workspaceId,
          currentActorUserId,
          opaqueActorToken,
        ),
      command,
    );
    expect(replayResult).toEqual({ serverEntryIds: [], localEntryIds: [] });
    expect(await readRows(sql, workspace.workspaceId)).toEqual(afterRows);
    expect(await queryAllLocal(page, workspace.workspaceId)).toEqual(afterLocal);

    await page.evaluate(
      (workspaceId) => window.__auditPseudonymizationProof!.recreate(workspaceId),
      workspace.workspaceId,
    );
    const reopened = await page.evaluate(() =>
      window.__auditPseudonymizationProof!.snapshot(),
    );
    expect(reopened.journal).toHaveLength(beforeRows.length);
    expect(
      reopened.journal.every((entry) => entry.actor_user_id === opaqueActorToken),
    ).toBe(true);
    expect(JSON.stringify(reopened)).not.toContain(account.userId);
  } finally {
    await context?.close().catch(() => {});
    await signupContext.close().catch(() => {});
    await sql.end();
  }
});
