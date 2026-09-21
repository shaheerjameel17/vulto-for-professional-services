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
 * FDN-85 Stage 4 — atomic workspace/membership graph projection, proven end
 * to end in real Chromium: real Better Auth accounts, real Postgres, the real
 * FDN-84 sealed store, the real `LocalGraphWorkerRuntime`, real Loro + SQLite
 * WASM. The projection command runs inside a test-only Worker
 * (`runtime-workspace-projection-proof.worker.ts`); the server flow
 * (register / create / consume / confirm) is driven here with real cookies.
 *
 * No sync-engine acknowledgment is awaited anywhere on the projection path
 * (founder ruling Q1d): the runner disposes the runtime after a synchronous
 * durable flush, and `#enqueueLocalDeltasForSync` is fire-and-forget.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple workspace projection 85!";

type Body = Record<string, unknown>;

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn85-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Projection Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

/** Credentialed cross-origin POST from the page. */
async function apiPost(
  page: Page,
  path: string,
  body: Body,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ origin, p, b }) => {
      const response = await fetch(`${origin}${p}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        /* no body */
      }
      return { status: response.status, body: parsed };
    },
    { origin: apiOrigin, p: path, b: body },
  );
}

async function openHarness(page: Page): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=fdn-85-harness`,
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { __vultoGraphPersistenceDiagnostics?: unknown })
        .__vultoGraphPersistenceDiagnostics !== undefined,
    undefined,
    { timeout: 20_000 },
  );
}

function harness(page: Page) {
  const proj = <T>(kind: string, message: Body): Promise<T> =>
    page.evaluate(
      ({ k, m }) => {
        const api = (
          window as unknown as {
            __vultoGraphPersistenceDiagnostics: {
              workspaceProjection: Record<
                string,
                (arg: Record<string, unknown>) => Promise<unknown>
              >;
            };
          }
        ).__vultoGraphPersistenceDiagnostics.workspaceProjection;
        const fn: Record<string, (a?: Record<string, unknown>) => Promise<unknown>> = {
          deviceId: () => api.deviceId(),
          runFounding: () => api.runFounding(m),
          foundingThenOrdinaryMutate: () => api.foundingThenOrdinaryMutate(m),
          runTransition: () => api.runTransition(m),
          queryMembership: () => api.queryMembership(m.workspaceId as never),
        };
        return fn[k]!();
      },
      { k: kind, m: message },
    ) as Promise<T>;
  return {
    deviceId: () => proj<{ deviceId: string }>("deviceId", {}),
    runFounding: (m: Body) =>
      proj<{ outboxEntry: { kind: string; authorizationPath: string } }>(
        "runFounding",
        m,
      ),
    foundingThenOrdinaryMutate: (m: Body) =>
      proj<{ projectionCommitted: boolean; ordinaryMutateStatus: string }>(
        "foundingThenOrdinaryMutate",
        m,
      ),
    runTransition: (m: Body) => proj<{ committed: boolean }>("runTransition", m),
    queryMembership: (workspaceId: string) =>
      proj<{
        membershipLifecycle: string | null;
        membershipRole: string | null;
        membershipOfTo: string | null;
        membershipInTo: string | null;
      }>("queryMembership", { workspaceId }),
  };
}

/** Register the harness Worker's device, create a workspace, consume the grant. */
async function foundGrant(page: Page, workspaceName = "Northwind") {
  const { deviceId } = await harness(page).deviceId();
  const reg = await apiPost(page, "/devices/register", {
    deviceId,
    deviceName: "Projection proof",
    platform: "web",
  });
  expect(reg.status, JSON.stringify(reg.body)).toBe(200);

  const created = await apiPost(page, "/workspace/create", { workspaceName, deviceId });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const grant = created.body as Body;

  const consumed = await apiPost(page, "/workspace/consume-projection-grant", {
    grant: grant.grant,
    workspaceId: grant.workspaceId,
    membershipId: grant.membershipId,
    deviceId,
  });
  expect(consumed.status, JSON.stringify(consumed.body)).toBe(200);

  return {
    deviceId,
    grant,
    consumed: consumed.body as Body,
    workspaceId: String(grant.workspaceId),
    membershipId: String(grant.membershipId),
    userId: String((consumed.body as Body).userId),
  };
}

function foundingMessage(
  f: Awaited<ReturnType<typeof foundGrant>>,
  workspaceName: string,
): Body {
  return {
    consumed: f.consumed,
    serverHalf: String(f.grant.serverHalf),
    keyEpoch: Number(f.grant.keyEpoch),
    workspaceName,
    occurredAt: "2026-02-01T00:00:00.000Z",
  };
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  // F122: each test signs up its own account; reset the shared rate-limit
  // window so one test's sign-up cannot exhaust the next's. The limit itself
  // is never relaxed.
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await resetRateLimits(sql);
  } finally {
    await sql.end();
  }
});

test.describe("FDN-85 Stage 4 — workspace/membership projection", () => {
  test("founding grant, online: five records project, membership confirms, queries back; then offline continuity", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const account = await signUp(page, sql);
      await context.addCookies(account.cookies);
      await openHarness(page);

      const f = await foundGrant(page, "Northwind");
      const founding = await harness(page).runFounding(foundingMessage(f, "Northwind"));
      expect(founding.outboxEntry.kind).toBe("admission");
      expect(founding.outboxEntry.authorizationPath).toBe(
        "privileged-projection-exception",
      );

      const confirmed = await apiPost(page, "/workspace/confirm-projection", {
        workspaceId: f.workspaceId,
        membershipId: f.membershipId,
      });
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

      const [row] = await sql<{ status: string; projection_state: string }[]>`
        select "status", "projection_state" from "member" where "id" = ${f.membershipId}`;
      expect(row).toMatchObject({ status: "active", projection_state: "confirmed" });

      const membership = await harness(page).queryMembership(f.workspaceId);
      expect(membership.membershipLifecycle).toBe("Active");
      expect(membership.membershipRole).toBe("owner");
      expect(membership.membershipOfTo).toBe(f.userId);
      expect(membership.membershipInTo).toBe(f.workspaceId);

      // Offline continuity: cut the network, the projected records still query
      // back (they were durably flushed; the fresh runtime unlock is the one
      // server round-trip — F106 — so it happens before the cut).
      await context.setOffline(true);
      const reachable = await page.evaluate(async (o) => {
        try {
          await fetch(`${o}/health`, { cache: "no-store" });
          return true;
        } catch {
          return false;
        }
      }, apiOrigin);
      expect(reachable).toBe(false);
      await context.setOffline(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("session lifetime: after the projection command, an ordinary mutate through the same handle is denied", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const account = await signUp(page, sql);
      await context.addCookies(account.cookies);
      await openHarness(page);

      const f = await foundGrant(page, "Contoso");
      const outcome = await harness(page).foundingThenOrdinaryMutate(
        foundingMessage(f, "Contoso"),
      );
      expect(outcome.projectionCommitted).toBe(true);
      // Exactly as for a caller with no grant.
      expect(outcome.ordinaryMutateStatus).toBe("denied");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("tenant crossing: a device authenticated to workspace A cannot open workspace B's graph", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const account = await signUp(page, sql);
      await context.addCookies(account.cookies);
      await openHarness(page);

      const foreignWorkspaceId = crypto.randomUUID();
      await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
        values (${foreignWorkspaceId}, 'Foreign Co', ${`foreign-${foreignWorkspaceId}`}, now(), 'active')`;

      await expect(harness(page).queryMembership(foreignWorkspaceId)).rejects.toThrow();
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("removal: central denial is immediate, then the revocation projects Revoked history and confirms", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const account = await signUp(page, sql);
      await context.addCookies(account.cookies);
      await openHarness(page);

      const f = await foundGrant(page, "Initech");
      await harness(page).runFounding(foundingMessage(f, "Initech"));
      await apiPost(page, "/workspace/confirm-projection", {
        workspaceId: f.workspaceId,
        membershipId: f.membershipId,
      });

      const memberId = crypto.randomUUID();
      const secondUser = crypto.randomUUID();
      await sql`insert into "user" ("id", "name", "email", "email_verified", "created_at", "updated_at", "status")
        values (${secondUser}, 'Second', ${`second-${secondUser}@example.com`}, true, now(), now(), 'active')`;
      await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
        values (${memberId}, ${f.workspaceId}, ${secondUser}, 'team-member', now(), 'active', 'confirmed')`;

      const revoked = await apiPost(page, "/workspace/revoke-member", {
        workspaceId: f.workspaceId,
        membershipId: memberId,
      });
      expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);

      // Central denial is immediate — before any history projection.
      const [row] = await sql<{ status: string; projection_state: string }[]>`
        select "status", "projection_state" from "member" where "id" = ${memberId}`;
      expect(row).toMatchObject({
        status: "revoked",
        projection_state: "revocation-pending",
      });

      await harness(page).runTransition({
        transitionKind: "revocation",
        workspaceId: f.workspaceId,
        membershipId: memberId,
        roles: ["team-member"],
        actorUserId: f.userId,
        occurredAt: "2026-03-01T00:00:00.000Z",
      });

      const confirmed = await apiPost(
        page,
        "/workspace/confirm-revocation-projection",
        {
          workspaceId: f.workspaceId,
          membershipId: memberId,
        },
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      const [after] = await sql<{ projection_state: string }[]>`
        select "projection_state" from "member" where "id" = ${memberId}`;
      expect(after?.projection_state).toBe("confirmed");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
