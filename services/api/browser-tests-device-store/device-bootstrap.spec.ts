import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * FDN-63 — Tier 0/2 first-device bootstrap as an explicit trusted-device flow.
 *
 * The done criterion: "A newly registered device is trusted and bootstraps its
 * own local Tier 0/2 history without requiring FDN-52 or FDN-85." Proven here
 * end to end on the real stack — a fresh account, a fresh workspace, a device
 * that registers (through the graph client's own `unlockOnline`, which now
 * performs `device.register`), unlocks, `initialize()`s an empty document, and
 * `mutate`s Tier 0/2 content into it that survives a genuine Worker restart.
 *
 * And the negative: an unregistered device, and a revoked one, cannot unlock —
 * so they cannot bootstrap anything.
 *
 * Nothing here touches a protected partition, a workspace/membership graph
 * node, or the relay: FDN-52, FDN-85 and FDN-51 are not in this path. If a
 * future change makes this test need any of them, the scope boundary is wrong.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple device bootstrap 63!";

interface BootstrapDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  query(graphQuery: unknown): Promise<{ node?: unknown }>;
  mutate(base64Snapshots: readonly string[]): Promise<{ status?: string }>;
  poisoning: { employeeId: string; buildClean(workspaceId: string): string };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: BootstrapDiagnosticsApi;
  }
}

const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string }> {
  const email = `browser-fdn63-bootstrap-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Bootstrap Device");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [row] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  return { userId: row.id };
}

async function createOwnerWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Bootstrap Co', ${`fdn63-bootstrap-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function openWorkspace(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

test.beforeAll(async () => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await resetRateLimits(sql);
  } finally {
    await sql.end();
  }
});

test.describe("FDN-63 — Tier 0/2 first-device bootstrap", () => {
  test("a freshly registered first device bootstraps and persists Tier 0/2 history", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const { userId } = await signUp(page, sql);
      const workspaceId = await createOwnerWorkspace(sql, userId);

      // The graph client registers this device (unlockOnline -> /devices/register)
      // and unlocks. The workspace has no prior history from any device.
      await openWorkspace(page, workspaceId);

      // A brand-new `device` row exists for this user — trust with no manual
      // approval step, exactly one registration.
      const devices = await sql<
        { id: string; isRevoked: boolean }[]
      >`select "id", "is_revoked" as "isRevoked" from "device" where "user_id" = ${userId}`;
      expect(devices).toHaveLength(1);
      expect(devices[0]?.isRevoked).toBe(false);
      const events = await sql<
        { eventType: string }[]
      >`select "event_type" as "eventType" from "device_trust_event" where "device_id" = ${devices[0]!.id}`;
      expect(events.map((e) => e.eventType)).toContain("registered");

      const bootstrapped = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
        const outcome = await api.mutate([api.poisoning.buildClean(id)]);
        await new Promise((resolve) => setTimeout(resolve, 700));
        return outcome.status;
      }, workspaceId);
      expect(
        bootstrapped,
        "an empty first document must accept a Tier 0/2 mutation",
      ).toBe("applied");

      // Survives a genuine Worker restart (new page, same IndexedDB).
      await page.close();
      const page2 = await context.newPage();
      await openWorkspace(page2, workspaceId);
      const present = await page2.evaluate(async (nodeId) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
        const result = (await api.query({
          kind: "node-get",
          nodeId,
          nodeType: "Employee",
          includeSoftDeleted: false,
        })) as { node?: unknown };
        return result.node !== null && result.node !== undefined;
      }, SEED_EMPLOYEE);
      expect(present, "the bootstrapped Tier 0/2 history must be durable").toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("an unregistered device cannot unlock, and a revoked one cannot re-unlock", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const { userId } = await signUp(page, sql);
      const workspaceId = await createOwnerWorkspace(sql, userId);
      const cookies = await context.cookies(apiOrigin);

      // A device id that never registered — a direct unlock attempt is denied.
      const unregistered = await context.request.post(
        `${apiOrigin}/device-store/unlock`,
        {
          headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
          data: {
            workspaceId,
            deviceId: `unregistered-${crypto.randomUUID()}`.slice(0, 40),
          },
        },
      );
      expect(unregistered.status(), "an unregistered device is denied at unlock").toBe(
        401,
      );

      // Now register + unlock normally, then retire the device row and prove
      // it cannot open the workspace again.
      await openWorkspace(page, workspaceId);
      const [device] = await sql<
        { id: string }[]
      >`select "id" from "device" where "user_id" = ${userId}`;
      await sql`update "device" set "is_revoked" = true where "id" = ${device!.id}`;

      await page.close();
      const page2 = await context.newPage();
      await page2.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await page2.getByRole("button", { name: "Retry" }).click();
      const unlockedVisible = await page2
        .getByTestId("graph-persistence-unlocked")
        .isVisible({ timeout: 8_000 })
        .catch(() => false);
      expect(unlockedVisible, "a revoked device must not reopen the workspace").toBe(
        false,
      );
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
