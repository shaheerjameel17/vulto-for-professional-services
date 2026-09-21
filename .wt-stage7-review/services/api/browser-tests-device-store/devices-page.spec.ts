import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * FDN-63 Stage 6 — `VPS-F001`'s Devices screen, on the real stack.
 *
 * Proves the two things the screen exists to get right: the Modal-confirmed
 * Revoke that `VPS-F001` mandates ("revocation is destructive, irreversible
 * from the user's side, and wipes a colleague's local data"), and F191's
 * separation of that Owner action from the device owner's own global
 * retirement — two actions, two scopes, two confirmations.
 *
 * Also the Restricted system state: "Non-Owner viewing Devices sees only
 * their own devices, with no indication others exist."
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple devices page 63!";

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
  name: string,
): Promise<{ userId: string }> {
  const email = `browser-fdn63-page-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [row] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  return { userId: row.id };
}

async function createWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
  role: "owner" | "team-member",
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Devices Page Co', ${`fdn63-page-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function joinWorkspace(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
  userId: string,
  role: "owner" | "team-member",
): Promise<void> {
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, ${role}, now(), 'active', 'confirmed')`;
}

/** Registers and unlocks a device by driving the real graph client. */
async function bringDeviceIntoWorkspace(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

async function openDevicesPage(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`${webOrigin}/devices?workspaceId=${workspaceId}`);
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByTestId("devices-table")).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async () => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await resetRateLimits(sql);
  } finally {
    await sql.end();
  }
});

test.describe("FDN-63 — the Devices screen", () => {
  test("lists the workspace's devices and revokes one behind a Modal confirmation", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const { userId } = await signUp(page, sql, "Devices Page Owner");
      const workspaceId = await createWorkspace(sql, userId, "owner");
      await bringDeviceIntoWorkspace(page, workspaceId);

      await openDevicesPage(page, workspaceId);

      // VPS-F001's columns.
      for (const header of ["Device", "Application", "Last active"]) {
        await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
      }
      const [row] = await sql<
        { id: string; deviceName: string }[]
      >`select "id", "device_name" as "deviceName" from "device" where "user_id" = ${userId}`;
      await expect(
        page.getByText(row!.deviceName, { exact: false }).first(),
      ).toBeVisible();

      // Revocation is Modal-confirmed — no exceptions (VPS-F001).
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await expect(
        modal.getByText("this workspace", { exact: false }).first(),
        "the Revoke modal must name its workspace scope, not just say 'cannot be undone'",
      ).toBeVisible();

      // Cancelling must change nothing — a confirmation that acts on open is not one.
      await modal.getByRole("button", { name: "Cancel" }).click();
      await expect(modal).not.toBeVisible();
      const [untouched] = await sql<
        { revokedAt: Date | null }[]
      >`select "revoked_at" as "revokedAt" from "device_unlock_secret" where "device_id" = ${row!.id}`;
      expect(untouched?.revokedAt, "cancelling must revoke nothing").toBeNull();

      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Revoke", exact: true })
        .click();

      await expect(page.getByText("Revoked here")).toBeVisible({ timeout: 20_000 });
      const [revoked] = await sql<
        { revokedAt: Date | null }[]
      >`select "revoked_at" as "revokedAt" from "device_unlock_secret" where "device_id" = ${row!.id}`;
      expect(revoked?.revokedAt).not.toBeNull();

      // F191: the workspace-scoped action must not have retired the identity.
      const [identity] = await sql<
        { isRevoked: boolean }[]
      >`select "is_revoked" as "isRevoked" from "device" where "id" = ${row!.id}`;
      expect(identity?.isRevoked).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("offers the device's own user a distinct global retirement, with its own copy", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const { userId } = await signUp(page, sql, "Retiring Owner");
      const workspaceId = await createWorkspace(sql, userId, "owner");
      await bringDeviceIntoWorkspace(page, workspaceId);
      await openDevicesPage(page, workspaceId);

      const retire = page.getByRole("button", { name: "Retire everywhere" });
      await expect(
        retire,
        "the device's own user is offered retirement as a separate action",
      ).toBeVisible();
      await retire.click();

      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await expect(
        modal.getByText("everywhere", { exact: false }).first(),
        "the Retire modal must name the wider consequence",
      ).toBeVisible();
      await modal.getByRole("button", { name: "Retire everywhere" }).click();

      await expect(page.getByText("Retired")).toBeVisible({ timeout: 20_000 });
      const [identity] = await sql<
        { isRevoked: boolean }[]
      >`select "is_revoked" as "isRevoked" from "device" where "user_id" = ${userId}`;
      expect(identity?.isRevoked).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("Restricted: a non-Owner sees only their own device, with no sign others exist", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let ownerContext: BrowserContext | undefined;
    let memberContext: BrowserContext | undefined;
    try {
      await resetRateLimits(sql);

      ownerContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const ownerPage = await ownerContext.newPage();
      const owner = await signUp(ownerPage, sql, "Restricted Owner");
      const workspaceId = await createWorkspace(sql, owner.userId, "owner");
      await bringDeviceIntoWorkspace(ownerPage, workspaceId);

      memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const memberPage = await memberContext.newPage();
      const colleague = await signUp(memberPage, sql, "Restricted Member");
      await joinWorkspace(sql, workspaceId, colleague.userId, "team-member");
      await bringDeviceIntoWorkspace(memberPage, workspaceId);

      const [ownerDevice] = await sql<
        { id: string; deviceName: string }[]
      >`select "id", "device_name" as "deviceName" from "device" where "user_id" = ${owner.userId}`;
      const [memberDevice] = await sql<
        { id: string }[]
      >`select "id" from "device" where "user_id" = ${colleague.userId}`;
      expect(ownerDevice!.id).not.toBe(memberDevice!.id);

      await openDevicesPage(ownerPage, workspaceId);
      await expect(
        ownerPage.getByRole("row"),
        "the Owner sees both devices plus the header row",
      ).toHaveCount(3);

      await openDevicesPage(memberPage, workspaceId);
      await expect(
        memberPage.getByRole("row"),
        "the non-Owner sees only their own device plus the header row",
      ).toHaveCount(2);
      await expect(
        memberPage.getByRole("button", { name: "Revoke", exact: true }),
        "and is not offered the Owner-only revoke",
      ).toHaveCount(0);
    } finally {
      await ownerContext?.close();
      await memberContext?.close();
      await sql.end();
    }
  });
});
