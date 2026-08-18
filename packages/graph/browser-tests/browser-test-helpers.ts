import { expect, type Cookie, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * FDN-50 stage 1 made LocalGraphWorkerRuntime.initialize() fail fast while
 * the FDN-84 sealed store is locked, which this suite's /worker-diagnostics
 * harness must now unlock before it can reach "ready". Rather than invent a
 * third account/workspace/unlock helper, this duplicates the same shape
 * services/api/browser-tests-device-store/device-store.spec.ts and
 * graph-persistence.spec.ts already use, adapted for this suite's own
 * database and origins (playwright.config.ts's webServer). A shared
 * cross-package import was deliberately avoided: those two spec files live
 * in services/api's test tree, not behind any package export, and reaching
 * into another package's test-only files would be an awkward dependency for
 * a handful of lines that are cheap and safe to keep in sync by hand.
 */

export const webOrigin = "https://localhost:3120";
export const apiOrigin = "https://localhost:3121";
export const databaseUrl =
  process.env.FDN77_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn77_browser";
export const password = "Correct horse battery staple worker 77!";

export async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn77-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Worker Diagnostics Browser");
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

export async function createWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Worker Diagnostics Browser Co', ${`worker-diagnostics-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

export async function unlockAndWaitForReady(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("worker-status")).toHaveText("ready", {
    timeout: 30_000,
  });
}
