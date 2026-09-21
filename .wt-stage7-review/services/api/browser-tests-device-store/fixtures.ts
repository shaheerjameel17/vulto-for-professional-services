import { expect, type Page } from "@playwright/test";
import type postgres from "postgres";

/**
 * FDN-55 Stage 3 — the shared browser-suite fixture helpers.
 *
 * Every spec in this directory was hand-rolling its own `signUp`,
 * `createOwnerWorkspace`, `joinWorkspace` and `openWorkspace`, drifting in
 * small ways (different seed emails, slightly different SQL). This is the one
 * copy.
 *
 * **Scope boundary.** `VPS-A007` A007-T11's fixture generator — "a workspace
 * containing multiple entities across three jurisdictions, employees on
 * full-time/part-time/compressed/contractor arrangements, a provisional
 * holiday, assignments overlapping across a weekend, a payroll run
 * mid-approval, a Tier 1 record outside retention" — is blocked on the
 * feature schemas (Entity, Employee, Holiday, Assignment, PayRun) that do not
 * exist. What is centralised here is the auth / workspace / membership /
 * device setup those suites actually need today. The richer generator lands
 * with the features it describes.
 */

type Sql = ReturnType<typeof postgres>;

export const WEB_ORIGIN = "https://localhost:3110";
export const API_ORIGIN = "https://localhost:3111";

/** A strong, fixed password — the suites do not test password strength here. */
export const TEST_PASSWORD = "Correct horse battery staple browser fixture 55!";

/** A deterministic Employee node id the diagnostics `buildClean` helper seeds. */
export const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

export type WorkspaceRole = "owner" | "hr-admin" | "finance-admin" | "team-member";

/**
 * Sign up through the real form (the only path that mints a Better Auth
 * session cookie in the browser context) and return the created user's id.
 */
export async function signUpViaForm(
  page: Page,
  sql: Sql,
  name = "Browser Fixture",
): Promise<{ userId: string; email: string }> {
  const email = `browser-fixture-${crypto.randomUUID()}@example.com`;
  await page.goto(`${WEB_ORIGIN}/sign-up`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [row] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  if (!row) throw new Error(`sign-up did not create a user for ${email}`);
  return { userId: row.id, email };
}

/** Create an active, projection-confirmed workspace with `userId` in `role`. */
export async function createWorkspace(
  sql: Sql,
  userId: string,
  role: WorkspaceRole = "owner",
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Fixture Co', ${`fixture-${workspaceId}`}, now(), 'active')`;
  await joinWorkspace(sql, workspaceId, userId, role);
  return workspaceId;
}

/** Add `userId` to an existing workspace, active and confirmed. */
export async function joinWorkspace(
  sql: Sql,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = "team-member",
): Promise<void> {
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
}

/**
 * Drive the graph-persistence diagnostics page to register this browser
 * context's device and unlock the workspace's sealed store — the real
 * `unlockOnline` path, which performs `device.register` first (FDN-63).
 */
export async function bringDeviceIntoWorkspace(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await page.goto(
    `${WEB_ORIGIN}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

/** The device_unlock_secret rows a workspace has, in creation order. */
export async function unlockedDeviceIds(
  sql: Sql,
  workspaceId: string,
): Promise<string[]> {
  const rows = await sql<{ deviceId: string }[]>`select "device_id" as "deviceId"
    from "device_unlock_secret" where "workspace_id" = ${workspaceId}
    order by "created_at" asc`;
  return rows.map((row) => row.deviceId);
}
