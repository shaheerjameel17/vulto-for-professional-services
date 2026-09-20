import { expect, test, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple audit contract 68!";

interface AuditActorContext {
  workspaceId: string;
  userId: string;
  membershipId: string;
  application: string;
  roles: string[];
}

interface ProofHandle {
  open(workspaceId: string): Promise<{ context: AuditActorContext; deviceId: string }>;
  lock(): Promise<{ contextAvailable: boolean }>;
  reopen(workspaceId: string): Promise<AuditActorContext>;
  decisions(
    permutations: string[][],
  ): Promise<
    Array<{ outcome: string; decidingRole: string | null; rolesSnapshot: string[] }>
  >;
  validate(entries: unknown[]): Promise<boolean[]>;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: {
      createAuditContractContextProof(): ProofHandle;
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn68-contract-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Audit Contract Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}
  `;
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

function auditEntry(workspaceId: string, actorUserId: string, membershipId: string) {
  return {
    audit_entry_id: crypto.randomUUID(),
    schema_version: 1,
    workspace_id: workspaceId,
    event_type: "PermissionDenied",
    operation: "NodeRead",
    outcome: "Denied",
    actor_user_id: actorUserId,
    actor_membership_id: membershipId,
    actor_role: null,
    actor_roles: ["owner", "hr-admin", "finance-admin", "team-member"],
    actor_application: "VultoRoster",
    target: {
      kind: "NodeTarget",
      node_type: "Employee",
      node_id: null,
      partition_key: "compensation",
      target_tier: 1,
    },
    metadata: {
      denial_class: "InsufficientPermission",
      result_cardinality: "Single",
    },
    occurred_at: "2026-09-10T09:00:00.000Z",
  };
}

test("authenticated Worker identity, deterministic deciding role, closed contract, and lock re-authentication hold through the real stack", async ({
  browser,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const bootstrap = await browser.newContext({ ignoreHTTPSErrors: true });
  const bootstrapPage = await bootstrap.newPage();
  let authenticatedContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await resetRateLimits(sql);
    const account = await signUp(bootstrapPage, sql);
    await bootstrap.close();

    const workspaceId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
      values (${workspaceId}, 'Audit Contract Co', ${`audit-contract-${workspaceId}`}, now(), 'active')`;
    await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
      values (${membershipId}, ${workspaceId}, ${account.userId}, 'team-member,finance-admin,hr-admin,owner', now(), 'active', 'confirmed')`;

    authenticatedContext = await browser.newContext({ ignoreHTTPSErrors: true });
    await authenticatedContext.addCookies(account.cookies);
    const page = await authenticatedContext.newPage();
    await page.goto(
      `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
      timeout: 20_000,
    });

    // Playwright cannot marshal a Worker-backed object out of page.evaluate;
    // retain the handle in-page and invoke it there for every observation.
    await page.evaluate(() => {
      const api = window.__vultoGraphPersistenceDiagnostics;
      if (!api) throw new Error("diagnostics API missing");
      (
        window as typeof window & { __auditContextProof?: ProofHandle }
      ).__auditContextProof = api.createAuditContractContextProof();
    });
    const opened = await page.evaluate(async (id) => {
      const handle = (window as typeof window & { __auditContextProof?: ProofHandle })
        .__auditContextProof;
      if (!handle) throw new Error("audit proof handle missing");
      return handle.open(id);
    }, workspaceId);

    const [dbIdentity] = await sql<
      { user_id: string; application: string; membership_id: string; role: string }[]
    >`
      select d."user_id", d."application", m."id" as "membership_id", m."role"
      from "device" d
      join "member" m on m."user_id" = d."user_id" and m."organization_id" = ${workspaceId}
      where d."id" = ${opened.deviceId}
    `;
    expect(opened.context).toEqual({
      workspaceId,
      userId: dbIdentity.user_id,
      membershipId: dbIdentity.membership_id,
      application: dbIdentity.application,
      roles: ["team-member", "finance-admin", "hr-admin", "owner"],
    });
    expect(opened.context.userId).toBe(account.userId);

    const permutations = [
      ["team-member", "manager", "finance-admin", "hr-admin", "owner"],
      ["owner", "hr-admin", "finance-admin", "manager", "team-member"],
      ["manager", "owner", "team-member", "hr-admin", "finance-admin"],
      ["hr-admin", "finance-admin", "owner", "team-member", "manager"],
    ];
    const decisions = await page.evaluate(async (values) => {
      const handle = (window as typeof window & { __auditContextProof?: ProofHandle })
        .__auditContextProof!;
      return handle.decisions(values);
    }, permutations);
    for (const decision of decisions) {
      expect(decision).toEqual({
        outcome: "full",
        decidingRole: "owner",
        rolesSnapshot: ["owner", "hr-admin", "finance-admin", "manager", "team-member"],
      });
    }

    const valid = auditEntry(workspaceId, account.userId, membershipId);
    const validEdge = {
      ...valid,
      audit_entry_id: crypto.randomUUID(),
      event_type: "SensitiveAccessGranted",
      operation: "EdgeTraversal",
      outcome: "Granted",
      actor_role: "owner",
      target: {
        kind: "EdgeTarget",
        edge_type: "assigned_to",
        edge_id: null,
        from_node_type: "Assignment",
        to_node_type: "Project",
        target_tier: 1,
      },
      metadata: { result_cardinality: "Collection" },
    };
    const validQuery = {
      ...valid,
      audit_entry_id: crypto.randomUUID(),
      event_type: "AuthorizedOperationFailed",
      operation: "NodeList",
      outcome: "Failed",
      actor_role: "owner",
      target: {
        kind: "QueryTarget",
        query_kind: "node-list",
        requested_node_type: "Employee",
        target_tier: 1,
      },
      metadata: {
        failure_class: "InvalidInput",
        result_cardinality: "Collection",
      },
    };
    const validation = await page.evaluate(
      async ({ validEntry, validEdgeEntry, validQueryEntry }) => {
        const handle = (window as typeof window & { __auditContextProof?: ProofHandle })
          .__auditContextProof!;
        return handle.validate([
          validEntry,
          validEdgeEntry,
          validQueryEntry,
          {
            ...validEntry,
            target: { ...validEntry.target, restricted_value: "salary" },
          },
          {
            ...validEntry,
            metadata: { ...validEntry.metadata, exception_text: "secret" },
          },
          { ...validEntry, metadata: { failure_class: "DatabaseExploded" } },
          { ...validEntry, target: { ...validEntry.target, kind: "UnknownTarget" } },
        ]);
      },
      { validEntry: valid, validEdgeEntry: validEdge, validQueryEntry: validQuery },
    );
    expect(validation).toEqual([true, true, true, false, false, false, false]);

    const newMembershipId = crypto.randomUUID();
    await sql`update "member" set "id" = ${newMembershipId}, "role" = 'hr-admin,owner'
      where "id" = ${membershipId}`;
    const locked = await page.evaluate(async () => {
      const handle = (window as typeof window & { __auditContextProof?: ProofHandle })
        .__auditContextProof!;
      return handle.lock();
    });
    expect(locked).toEqual({ contextAvailable: false });
    const reopened = await page.evaluate(async (id) => {
      const handle = (window as typeof window & { __auditContextProof?: ProofHandle })
        .__auditContextProof!;
      return handle.reopen(id);
    }, workspaceId);
    expect(reopened.membershipId).toBe(newMembershipId);
    expect(reopened.roles).toEqual(["hr-admin", "owner"]);
    expect(reopened.userId).toBe(account.userId);
    expect(reopened.application).toBe("VultoRoster");

    await page.evaluate(async () => {
      const owner = window as typeof window & { __auditContextProof?: ProofHandle };
      await owner.__auditContextProof?.dispose();
      delete owner.__auditContextProof;
    });
    await authenticatedContext.close();
    authenticatedContext = undefined;
  } finally {
    await authenticatedContext?.close().catch(() => {});
    await bootstrap.close().catch(() => {});
    await sql.end();
  }
});
