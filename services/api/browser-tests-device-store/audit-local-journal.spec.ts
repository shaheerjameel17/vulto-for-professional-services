import { expect, test, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit local journal 68!";

interface AuditEntryView {
  audit_entry_id: string;
  event_type: string;
  operation: string;
  outcome: string;
  actor_role: string | null;
  actor_roles: string[];
  target: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface Snapshot {
  journal: AuditEntryView[];
  outbox: AuditEntryView[];
}

interface ProofHandle {
  open(workspaceId: string): Promise<unknown>;
  seed(): Promise<unknown>;
  queryTier(tier: 0 | 1 | 2 | 3): Promise<{ result: { node: unknown } }>;
  queryTierList(tier: 0 | 1): Promise<{ nodes: unknown[] }>;
  querySkill(): Promise<{ node: unknown }>;
  snapshot(): Promise<Snapshot>;
  reopenJournal(): Promise<Snapshot>;
  proveIdempotency(): Promise<{
    before: number;
    afterIdenticalReplay: number;
    afterConflictingReplay: number;
    conflict: string;
  }>;
  lock(): Promise<unknown>;
  reunlock(workspaceId: string): Promise<unknown>;
  recreate(workspaceId: string): Promise<unknown>;
  abortNextAudit(): Promise<unknown>;
  forceAuthorizedFailure(): Promise<{ failed: boolean; callerError: string }>;
  mutateTier1(): Promise<{ status: string }>;
  mutateTier1Edge(): Promise<{ status: string }>;
  mutateDenied(): Promise<{ status: string }>;
  measure(count: number): Promise<{ durations: number[] }>;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: {
      createAuditLocalJournalProof(): ProofHandle;
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-journal-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Journal Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}
  `;
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

test("local audit journal enforces denial, sensitive-release, durability, offline, failure, and latency boundaries on the real stack", async ({
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
    await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
      values (${workspaceId}, 'Audit Journal Co', ${`audit-journal-${workspaceId}`}, now(), 'active')`;
    await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
      values (${membershipId}, ${workspaceId}, ${account.userId}, 'team-member', now(), 'active', 'confirmed')`;

    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(account.cookies);
    const page = await context.newPage();
    await page.goto(
      `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
      timeout: 20_000,
    });
    await page.evaluate(() => {
      const api = window.__vultoGraphPersistenceDiagnostics;
      if (!api) throw new Error("diagnostics API missing");
      (
        window as typeof window & { __auditJournalProof?: ProofHandle }
      ).__auditJournalProof = api.createAuditLocalJournalProof();
    });

    const invoke = <T>(method: string, argument?: unknown) =>
      page.evaluate(
        async ({ name, value }) => {
          const handle = (
            window as typeof window & { __auditJournalProof?: ProofHandle }
          ).__auditJournalProof;
          if (!handle) throw new Error("audit journal proof handle missing");
          const callable = (
            handle as unknown as Record<
              string,
              (...args: unknown[]) => Promise<unknown>
            >
          )[name];
          return (await callable(value)) as T;
        },
        { name: method, value: argument },
      );

    await invoke("open", workspaceId);
    await invoke("seed");

    for (const tier of [0, 1, 2] as const) {
      const denied = await invoke<{ result: { node: unknown } }>("queryTier", tier);
      expect(denied.result.node).toBeNull();
    }
    let snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal).toHaveLength(3);
    expect(snapshot.journal.map((entry) => entry.target.target_tier)).toEqual([
      0, 1, 2,
    ]);
    expect(
      snapshot.journal.every((entry) => entry.event_type === "PermissionDenied"),
    ).toBe(true);
    const deniedMutation = await invoke<{ status: string }>("mutateDenied");
    expect(deniedMutation.status).toBe("denied");
    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal.at(-1)).toMatchObject({
      event_type: "PermissionDenied",
      operation: "NodeCreate",
      target: { kind: "NodeTarget", target_tier: 2 },
      metadata: { denial_class: "InsufficientPermission" },
    });
    const collectionBefore = snapshot.journal.length;
    const deniedCollection = await invoke<{ nodes: unknown[] }>("queryTierList", 0);
    expect(deniedCollection.nodes).toEqual([]);
    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal).toHaveLength(collectionBefore + 1);
    expect(snapshot.journal.at(-1)).toMatchObject({
      operation: "NodeList",
      target: {
        kind: "QueryTarget",
        requested_node_type: "HeadcountSnapshot",
        target_tier: 0,
      },
      metadata: { result_cardinality: "Collection" },
    });
    expect(snapshot.journal.at(-1)?.target).not.toHaveProperty("node_id");

    await sql`update "member" set "role" = 'owner' where "id" = ${membershipId}`;
    await invoke("lock");
    await invoke("reunlock", workspaceId);
    const tier3Denied = await invoke<{ result: { node: unknown } }>("queryTier", 3);
    expect(tier3Denied.result.node).toBeNull();
    const tier1Granted = await invoke<{ result: { node: unknown } }>("queryTier", 1);
    expect(tier1Granted.result.node).not.toBeNull();

    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal).toHaveLength(7);
    expect(snapshot.journal[5]).toMatchObject({
      event_type: "PermissionDenied",
      outcome: "Denied",
      actor_role: null,
      target: { target_tier: 3 },
    });
    expect(snapshot.journal[6]).toMatchObject({
      event_type: "SensitiveAccessGranted",
      outcome: "Granted",
      actor_role: "owner",
      target: { target_tier: 1 },
    });
    expect(snapshot.outbox.map((entry) => entry.audit_entry_id)).toEqual(
      snapshot.journal.map((entry) => entry.audit_entry_id),
    );

    const tier1Collection = await invoke<{ nodes: Array<{ nodeId: string }> }>(
      "queryTierList",
      1,
    );
    expect(tier1Collection.nodes).toHaveLength(2);
    snapshot = await invoke<Snapshot>("snapshot");
    const collectionEvidence = snapshot.journal.slice(-2);
    expect(collectionEvidence).toHaveLength(2);
    expect(collectionEvidence.every((entry) => entry.operation === "NodeList")).toBe(
      true,
    );
    expect(new Set(collectionEvidence.map((entry) => entry.target.node_id)).size).toBe(
      2,
    );
    const tier1Mutation = await invoke<{ status: string }>("mutateTier1");
    expect(tier1Mutation.status).toBe("applied");
    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal.at(-1)).toMatchObject({
      event_type: "SensitiveAccessGranted",
      operation: "NodeCreate",
      outcome: "Granted",
      target: { kind: "NodeTarget", target_tier: 1 },
    });
    const tier1EdgeMutation = await invoke<{ status: string }>("mutateTier1Edge");
    expect(tier1EdgeMutation.status).toBe("applied");
    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal.at(-1)).toMatchObject({
      event_type: "SensitiveAccessGranted",
      operation: "EdgeCreate",
      outcome: "Granted",
      actor_role: "owner",
      target: {
        kind: "EdgeTarget",
        edge_type: "supersedes",
        edge_id: "68300000-0000-4000-8000-00000000000a",
        from_node_type: "RateCard",
        to_node_type: "RateCard",
        target_tier: 1,
      },
    });

    await context.setOffline(true);
    const offlineGrant = await invoke<{ result: { node: unknown } }>("queryTier", 1);
    expect(offlineGrant.result.node).not.toBeNull();
    const offlineSnapshot = await invoke<Snapshot>("reopenJournal");
    expect(offlineSnapshot.outbox).toHaveLength(12);
    await context.setOffline(false);

    const measured = await invoke<{ durations: number[] }>("measure", 8);
    expect(measured.durations).toHaveLength(8);
    const maximumAuditAppendMs = Math.max(...measured.durations);
    console.log(
      `FDN-68 real IndexedDB audit append durations (ms): ${measured.durations.map((value) => value.toFixed(3)).join(", ")}; max=${maximumAuditAppendMs.toFixed(3)}`,
    );
    expect(maximumAuditAppendMs).toBeLessThanOrEqual(10);

    await invoke("recreate", workspaceId);
    const rematerialized = await invoke<{ node: unknown }>("querySkill");
    expect(rematerialized.node).not.toBeNull();
    const reopened = await invoke<Snapshot>("snapshot");
    expect(reopened.journal).toHaveLength(20);
    expect(reopened.outbox.map((entry) => entry.audit_entry_id)).toEqual(
      reopened.journal.map((entry) => entry.audit_entry_id),
    );

    const idempotency = await invoke<{
      before: number;
      afterIdenticalReplay: number;
      afterConflictingReplay: number;
      conflict: string;
    }>("proveIdempotency");
    expect(idempotency).toEqual({
      before: 20,
      afterIdenticalReplay: 20,
      afterConflictingReplay: 20,
      conflict: "An audit_entry_id cannot be reused with different content",
    });
    await invoke("recreate", workspaceId);

    const forced = await invoke<{ failed: boolean; callerError: string }>(
      "forceAuthorizedFailure",
    );
    expect(forced).toEqual({
      failed: true,
      callerError: "forced secret exception text must never be persisted",
    });
    snapshot = await invoke<Snapshot>("snapshot");
    expect(snapshot.journal.at(-1)).toMatchObject({
      event_type: "AuthorizedOperationFailed",
      outcome: "Failed",
      metadata: { failure_class: "CommitFailed", result_cardinality: "Single" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("forced secret exception text");
    expect((await invoke<{ node: unknown }>("querySkill")).node).not.toBeNull();

    const beforeAbortCount = snapshot.journal.length;
    await invoke("abortNextAudit");
    const withheld = await page.evaluate(async () => {
      const handle = (window as typeof window & { __auditJournalProof?: ProofHandle })
        .__auditJournalProof!;
      try {
        await handle.queryTier(1);
        return { released: true, error: null };
      } catch (error) {
        return {
          released: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    expect(withheld.released).toBe(false);
    expect(withheld.error).toMatch(/IndexedDB transaction (aborted|failed)/);
    await expect(invoke("querySkill")).rejects.toThrow(
      "unavailable after audit persistence failed",
    );

    await invoke("recreate", workspaceId);
    const afterAbort = await invoke<Snapshot>("snapshot");
    expect(afterAbort.journal).toHaveLength(beforeAbortCount);
    expect(afterAbort.outbox).toHaveLength(beforeAbortCount);

    await invoke("dispose");
    await context.close();
    context = undefined;
  } finally {
    await context?.setOffline(false).catch(() => {});
    await context?.close().catch(() => {});
    await bootstrap.close().catch(() => {});
    await sql.end();
  }
});
