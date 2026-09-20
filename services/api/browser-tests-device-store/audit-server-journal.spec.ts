import { createHash } from "node:crypto";
import { expect, test, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit server 68!";

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
  [key: string]: unknown;
}

interface Snapshot {
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
  snapshot(): Promise<Snapshot>;
  appendAuditForCacheProof(entry: AuditEntryView): Promise<Snapshot>;
  flushOutbox(): Promise<Snapshot>;
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
  getSyncStatus(): { state: string; pendingLocalChanges: boolean };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: DiagnosticsApi;
    __auditServerProof?: ProofHandle;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
  label: string,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-server-${label.toLowerCase()}-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill(`Audit Server ${label}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}
  `;
  if (!user) throw new Error(`sign-up did not create ${label} user`);
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

async function createWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
  label: string,
): Promise<{ workspaceId: string; membershipId: string }> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, ${`Audit Server ${label}`}, ${`audit-server-${label}-${workspaceId}`}, now(), 'active')`;
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
    window.__auditServerProof = api.createAuditLocalJournalProof();
  });
  await page.evaluate((id) => window.__auditServerProof!.open(id), workspaceId);
}

async function apiRequest(
  page: Page,
  path: string,
  body: unknown,
  method = "POST",
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ target, payload, requestMethod }) => {
      const response = await fetch(target, {
        method: requestMethod,
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { target: `${apiOrigin}${path}`, payload: body, requestMethod: method },
  );
}

function localWindowStart(): string {
  const value = new Date();
  value.setUTCMonth(value.getUTCMonth() - 12);
  return value.toISOString();
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

function digest(entry: AuditEntryView): string {
  return createHash("sha256").update(canonicalJson(entry), "utf8").digest("base64url");
}

test("server audit journal is append-only, session-bound, reconnect-delivered, and pages historical records without gaps", async ({
  browser,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const signupA = await browser.newContext({ ignoreHTTPSErrors: true });
  const signupB = await browser.newContext({ ignoreHTTPSErrors: true });
  const signupTeamMember = await browser.newContext({ ignoreHTTPSErrors: true });
  let contextA: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextB: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextTeamMember: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await resetRateLimits(sql);
    const accountA = await signUp(await signupA.newPage(), sql, "A");
    await resetRateLimits(sql);
    const accountB = await signUp(await signupB.newPage(), sql, "B");
    await resetRateLimits(sql);
    const teamMemberAccount = await signUp(
      await signupTeamMember.newPage(),
      sql,
      "team-member",
    );
    const workspaceA = await createWorkspace(sql, accountA.userId, "A");
    const workspaceB = await createWorkspace(sql, accountB.userId, "B");
    const teamMembershipId = crypto.randomUUID();
    await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
      values (${teamMembershipId}, ${workspaceA.workspaceId}, ${teamMemberAccount.userId}, 'team-member', now(), 'active', 'confirmed')`;

    contextA = await browser.newContext({ ignoreHTTPSErrors: true });
    await contextA.addCookies(accountA.cookies);
    const pageA = await contextA.newPage();
    await unlockAndInitialize(pageA, workspaceA.workspaceId);
    const [deviceA] = await sql<{ id: string; application: string }[]>`
      select "id", "application" from "device"
      where "user_id" = ${accountA.userId} order by "registered_at" desc limit 1
    `;

    await pageA.evaluate(async (workspaceId) => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      await api.applyDeltaBatch([api.auditLocalQueryProof.buildSeed(workspaceId)]);
      await api.startSync();
      const result = await api.query({
        kind: "node-get",
        nodeType: "RateCard",
        nodeId: api.auditLocalQueryProof.tier1NodeId,
        includeSoftDeleted: false,
      });
      if (result.kind !== "node-get" || result.node === null) {
        throw new Error("Tier 1 production query did not complete");
      }
    }, workspaceA.workspaceId);

    await expect
      .poll(async () => {
        const [row] = await sql<{ count: number }[]>`
          select count(*)::int as "count" from "audit_journal"
          where "workspace_id" = ${workspaceA.workspaceId}::uuid
        `;
        return row.count;
      })
      .toBe(1);

    const [stored] = await sql<
      {
        entry: AuditEntryView;
        content_digest: string;
      }[]
    >`
      select "entry", "content_digest" from "audit_journal"
      where "workspace_id" = ${workspaceA.workspaceId}::uuid
    `;
    expect(stored.entry).toMatchObject({
      workspace_id: workspaceA.workspaceId,
      actor_user_id: accountA.userId,
      actor_membership_id: workspaceA.membershipId,
      actor_application: deviceA.application,
    });
    expect(stored.content_digest).toBe(digest(stored.entry));

    const identicalReplay = await apiRequest(pageA, "/audit/append", {
      workspaceId: workspaceA.workspaceId,
      deviceId: deviceA.id,
      entry: stored.entry,
    });
    expect(identicalReplay).toEqual({ status: 200, body: { appended: false } });
    const conflictingEntry = {
      ...stored.entry,
      occurred_at: new Date(Date.parse(stored.entry.occurred_at) + 1).toISOString(),
    };
    const conflictingReplay = await apiRequest(pageA, "/audit/append", {
      workspaceId: workspaceA.workspaceId,
      deviceId: deviceA.id,
      entry: conflictingEntry,
    });
    expect(conflictingReplay.status).toBe(409);
    const [unchanged] = await sql<{ entry: AuditEntryView }[]>`
      select "entry" from "audit_journal"
      where "workspace_id" = ${workspaceA.workspaceId}::uuid
        and "audit_entry_id" = ${stored.entry.audit_entry_id}::uuid
    `;
    expect(unchanged.entry).toEqual(stored.entry);

    for (const forged of [
      { ...stored.entry, actor_user_id: crypto.randomUUID() },
      { ...stored.entry, actor_membership_id: crypto.randomUUID() },
      { ...stored.entry, actor_application: "VultoAccounts" },
    ]) {
      const refused = await apiRequest(pageA, "/audit/append", {
        workspaceId: workspaceA.workspaceId,
        deviceId: deviceA.id,
        entry: forged,
      });
      expect(refused.status).toBe(401);
    }

    await contextA.setOffline(true);
    const offlineResult = await pageA.evaluate(async () => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      return api.query({
        kind: "node-get",
        nodeType: "RateCard",
        nodeId: api.auditLocalQueryProof.tier1NodeId,
        includeSoftDeleted: false,
      });
    });
    expect(offlineResult).toMatchObject({ kind: "node-get" });
    await expect
      .poll(() => pageA.evaluate(() => window.__auditServerProof!.snapshot()))
      .toMatchObject({ outbox: [{ event_type: "SensitiveAccessGranted" }] });
    await contextA.setOffline(false);
    await expect
      .poll(async () => {
        const [row] = await sql<{ count: number }[]>`
          select count(*)::int as "count" from "audit_journal"
          where "workspace_id" = ${workspaceA.workspaceId}::uuid
        `;
        return row.count;
      })
      .toBe(2);
    await expect
      .poll(() =>
        pageA.evaluate(
          async () => (await window.__auditServerProof!.snapshot()).outbox,
        ),
      )
      .toEqual([]);

    await pageA.route("**/audit/append", (route) => route.abort("failed"));
    const outageResult = await pageA.evaluate(async () => {
      const api = window.__vultoGraphPersistenceDiagnostics!;
      return api.query({
        kind: "node-get",
        nodeType: "RateCard",
        nodeId: api.auditLocalQueryProof.tier1NodeId,
        includeSoftDeleted: false,
      });
    });
    expect(outageResult).toMatchObject({ kind: "node-get" });
    await expect
      .poll(() =>
        pageA.evaluate(
          async () => (await window.__auditServerProof!.snapshot()).outbox,
        ),
      )
      .toHaveLength(1);
    const [duringOutage] = await sql<{ count: number }[]>`
      select count(*)::int as "count" from "audit_journal"
      where "workspace_id" = ${workspaceA.workspaceId}::uuid
    `;
    expect(duringOutage.count).toBe(2);
    await pageA.evaluate(
      (id) => window.__auditServerProof!.recreate(id),
      workspaceA.workspaceId,
    );
    await expect
      .poll(() =>
        pageA.evaluate(
          async () => (await window.__auditServerProof!.snapshot()).outbox,
        ),
      )
      .toHaveLength(1);
    await pageA.unroute("**/audit/append");
    await pageA.evaluate(() => window.__auditServerProof!.flushOutbox());
    await expect
      .poll(async () => {
        const [row] = await sql<{ count: number }[]>`
          select count(*)::int as "count" from "audit_journal"
          where "workspace_id" = ${workspaceA.workspaceId}::uuid
        `;
        return row.count;
      })
      .toBe(3);

    await pageA.evaluate(
      (id) => window.__auditServerProof!.recreate(id),
      workspaceA.workspaceId,
    );
    expect(
      await pageA.evaluate(
        async () => (await window.__auditServerProof!.snapshot()).outbox,
      ),
    ).toEqual([]);

    const oldEntries = [0, 1, 2].map((offset) => ({
      ...stored.entry,
      audit_entry_id: crypto.randomUUID(),
      occurred_at: `2020-01-0${offset + 1}T12:00:00.000Z`,
    }));
    for (const entry of oldEntries) {
      await sql`insert into "audit_journal" (
        "workspace_id", "audit_entry_id", "content_digest", "entry",
        "occurred_at", "actor_user_id", "event_type", "operation", "outcome",
        "target_kind", "target_node_type", "target_tier"
      ) values (
        ${workspaceA.workspaceId}::uuid, ${entry.audit_entry_id}::uuid,
        ${digest(entry)}, ${sql.json(entry)}, ${entry.occurred_at}::timestamptz,
        ${accountA.userId}::uuid, ${entry.event_type}, ${entry.operation},
        ${entry.outcome}, ${String(entry.target.kind)},
        ${String(entry.target.node_type)}, ${Number(entry.target.target_tier)}
      )`;
    }

    const directServerHistorical = await apiRequest(pageA, "/audit/query", {
      workspaceId: workspaceA.workspaceId,
      deviceId: deviceA.id,
      localWindowStart: localWindowStart(),
      filters: {
        startDate: "2020-01-01T00:00:00.000Z",
        endDate: "2020-12-31T23:59:59.999Z",
        limit: 2,
      },
    });
    expect(directServerHistorical).toMatchObject({
      status: 200,
      body: { entries: [{}, {}] },
    });

    const directHistorical = await pageA.evaluate(
      async (workspaceId) =>
        window.__vultoGraphPersistenceDiagnostics!.auditLog.query(workspaceId, {
          startDate: "2020-01-01T00:00:00.000Z",
          endDate: "2020-12-31T23:59:59.999Z",
          limit: 2,
        }),
      workspaceA.workspaceId,
    );
    expect(directHistorical).toMatchObject({
      kind: "audit-log-page",
      source: "Historical",
      entries: [{}, {}],
    });

    const pagedIds: string[] = [];
    const sources: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await pageA.evaluate(
        ({ workspaceId, next }) =>
          window.__vultoGraphPersistenceDiagnostics!.auditLog.query(workspaceId, {
            limit: 2,
            ...(next === undefined ? {} : { cursor: next }),
          }),
        { workspaceId: workspaceA.workspaceId, next: cursor },
      );
      if (page.kind !== "audit-log-page") throw new Error("audit page unavailable");
      sources.push(page.source);
      pagedIds.push(...page.entries.map((entry) => entry.audit_entry_id));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(sources).toEqual(["Local", "Local", "Historical", "Historical"]);
    expect(new Set(pagedIds).size).toBe(6);
    expect(new Set(pagedIds)).toEqual(
      new Set([
        ...(await pageA.evaluate(async () =>
          (await window.__auditServerProof!.snapshot()).journal.map(
            (entry) => entry.audit_entry_id,
          ),
        )),
        ...oldEntries.map((entry) => entry.audit_entry_id),
      ]),
    );

    const rawHistorical = await apiRequest(pageA, "/audit/query", {
      workspaceId: workspaceA.workspaceId,
      deviceId: deviceA.id,
      localWindowStart: localWindowStart(),
      filters: { limit: 1 },
    });
    expect(rawHistorical.status).toBe(200);
    const serverCursor = (rawHistorical.body as { nextCursor: string }).nextCursor;
    expect(serverCursor).toBeTruthy();

    contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    await contextB.addCookies(accountB.cookies);
    const pageB = await contextB.newPage();
    await unlockAndInitialize(pageB, workspaceB.workspaceId);
    const [deviceB] = await sql<{ id: string }[]>`
      select "id" from "device" where "user_id" = ${accountB.userId}
      order by "registered_at" desc limit 1
    `;
    expect(
      (
        await apiRequest(pageB, "/audit/append", {
          workspaceId: workspaceA.workspaceId,
          deviceId: deviceB.id,
          entry: stored.entry,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await apiRequest(pageB, "/audit/query", {
          workspaceId: workspaceA.workspaceId,
          deviceId: deviceB.id,
          localWindowStart: localWindowStart(),
          filters: { limit: 1 },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await apiRequest(pageB, "/audit/query", {
          workspaceId: workspaceB.workspaceId,
          deviceId: deviceB.id,
          localWindowStart: localWindowStart(),
          cursor: serverCursor,
          filters: { limit: 1 },
        })
      ).status,
    ).toBe(400);

    contextTeamMember = await browser.newContext({ ignoreHTTPSErrors: true });
    await contextTeamMember.addCookies(teamMemberAccount.cookies);
    const teamMemberPage = await contextTeamMember.newPage();
    await unlockAndInitialize(teamMemberPage, workspaceA.workspaceId);
    const [teamMemberDevice] = await sql<{ id: string }[]>`
      select "id" from "device" where "user_id" = ${teamMemberAccount.userId}
      order by "registered_at" desc limit 1
    `;
    const teamMemberHistoricalQuery = await apiRequest(teamMemberPage, "/audit/query", {
      workspaceId: workspaceA.workspaceId,
      deviceId: teamMemberDevice.id,
      localWindowStart: localWindowStart(),
      filters: { limit: 1 },
    });
    expect(teamMemberHistoricalQuery.status).toBe(401);

    const agedCacheEntry = {
      ...stored.entry,
      audit_entry_id: crypto.randomUUID(),
      occurred_at: "2020-02-01T12:00:00.000Z",
    };
    const agedPending = await pageA.evaluate(
      (entry) => window.__auditServerProof!.appendAuditForCacheProof(entry),
      agedCacheEntry,
    );
    expect(agedPending.journal.map((entry) => entry.audit_entry_id)).toContain(
      agedCacheEntry.audit_entry_id,
    );
    expect(agedPending.outbox.map((entry) => entry.audit_entry_id)).toContain(
      agedCacheEntry.audit_entry_id,
    );
    const afterAgedAcknowledgement = await pageA.evaluate(() =>
      window.__auditServerProof!.flushOutbox(),
    );
    expect(
      afterAgedAcknowledgement.journal.map((entry) => entry.audit_entry_id),
    ).not.toContain(agedCacheEntry.audit_entry_id);
    expect(
      afterAgedAcknowledgement.outbox.map((entry) => entry.audit_entry_id),
    ).not.toContain(agedCacheEntry.audit_entry_id);
    const [retainedAgedServerRow] = await sql<{ count: number }[]>`
      select count(*)::int as "count" from "audit_journal"
      where "workspace_id" = ${workspaceA.workspaceId}::uuid
        and "audit_entry_id" = ${agedCacheEntry.audit_entry_id}::uuid
    `;
    expect(retainedAgedServerRow.count).toBe(1);
    await pageA.evaluate(
      (id) => window.__auditServerProof!.recreate(id),
      workspaceA.workspaceId,
    );
    const reopenedAfterAgedAcknowledgement = await pageA.evaluate(() =>
      window.__auditServerProof!.snapshot(),
    );
    expect(
      reopenedAfterAgedAcknowledgement.journal.map((entry) => entry.audit_entry_id),
    ).not.toContain(agedCacheEntry.audit_entry_id);

    expect(
      (await pageA.request.patch(`${apiOrigin}/audit/append`, { data: {} })).status(),
    ).toBe(404);
    expect(
      (await pageA.request.delete(`${apiOrigin}/audit/append`, { data: {} })).status(),
    ).toBe(404);

    await pageA.route("**/audit/query", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await expect(
      pageA.evaluate(
        async (workspaceId) =>
          window.__vultoGraphPersistenceDiagnostics!.auditLog.query(workspaceId, {
            startDate: "2020-01-01T00:00:00.000Z",
            endDate: "2020-12-31T23:59:59.999Z",
            limit: 2,
          }),
        workspaceA.workspaceId,
      ),
    ).rejects.toThrow("Historical audit query is unavailable");
    await pageA.unroute("**/audit/query");
  } finally {
    await contextA?.setOffline(false).catch(() => {});
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await contextTeamMember?.close().catch(() => {});
    await signupA.close().catch(() => {});
    await signupB.close().catch(() => {});
    await signupTeamMember.close().catch(() => {});
    await sql.end();
  }
});
