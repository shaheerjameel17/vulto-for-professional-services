import { expect, test } from "@playwright/test";
import {
  device,
  eq,
  session,
  user,
} from "../../../services/api/src/test/sync-browser-support.js";
import {
  NetworkSwitch,
  PASSWORD,
  activateWorkspace,
  apiDirect,
  createOwnedWorkspace,
  db,
  openHarness,
  signInNewUser,
  untilSynced,
  webOrigin,
} from "./helpers.js";

const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

test("first workspace sets the active organization and mounts the real graph client", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const [current] = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId));
  expect(current?.activeOrganizationId).toBe(workspaceId);

  await page.goto(webOrigin);
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  expect(
    await page.evaluate(() =>
      indexedDB.databases().then((items) => items.map((item) => item.name)),
    ),
  ).toContain(`vulto:${workspaceId}:${userId}`);
});

test("a later sign-in activates its sole membership and syncs the real shell", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  const laterSignIn = await context.request.post(
    `${apiDirect}/api/auth/sign-in/email`,
    {
      headers: { origin: webOrigin },
      data: { email: account!.email, password: PASSWORD },
      ignoreHTTPSErrors: true,
    },
  );
  expect(laterSignIn.ok(), await laterSignIn.text()).toBe(true);
  await page.goto(webOrigin);
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const sessions = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId));
  expect(sessions.length).toBeGreaterThanOrEqual(2);
  expect(sessions.every((row) => row.activeOrganizationId === workspaceId)).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await db
            .select({ id: device.id })
            .from(device)
            .where(eq(device.userId, userId))
        ).length,
    )
    .toBeGreaterThan(0);
});

test("two active memberships with no selected organization stay unresolved", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  await createOwnedWorkspace(userId);
  await createOwnedWorkspace(userId);
  await db
    .update(session)
    .set({ activeOrganizationId: null })
    .where(eq(session.userId, userId));
  await page.goto(webOrigin);
  await expect(page.getByText("Connect to select a workspace.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open .* menu/ })).toHaveCount(0);
});

test("a confirmed no-session response goes to sign-in without workspace calls", async ({
  page,
}) => {
  const workspaceCalls: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/auth\/organization|\/workspace\/(list-active-memberships|activate-sole-membership)|\/v1\/shape|\/trpc|\/devices\/register/.test(
        request.url(),
      )
    )
      workspaceCalls.push(request.url());
  });
  await page.goto(webOrigin);
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
  expect(workspaceCalls).toEqual([]);
});

test("a refused network request on cold boot uses the sole cached workspace", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  network.cut(); // Destroys TCP connections and refuses new ones, including /get-session.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Offline", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(page.url()).not.toContain("/sign-in");
  expect(
    await page.evaluate(() =>
      indexedDB.databases().then((items) => items.map((item) => item.name)),
    ),
  ).toContain(`vulto:${workspaceId}:${userId}`);
});

test("cold offline boot with two caches refuses to guess or redirect to sign-in", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const first = await createOwnedWorkspace(userId);
  const second = await createOwnedWorkspace(userId);
  await openHarness(page, first, userId);
  await untilSynced(page, 0);
  await openHarness(page, second, userId);
  await untilSynced(page, 0);
  await activateWorkspace(userId, first);

  network.cut();
  await page.goto(webOrigin);
  await expect(page.getByText("Connect to select a workspace.")).toBeVisible({
    timeout: 60_000,
  });
  expect(page.url()).not.toContain("/sign-in");
  await expect(page.getByRole("button", { name: /Open .* menu/ })).toHaveCount(0);
});

test("a server 401 from a live client reaches the shell boundary", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await db.delete(session).where(eq(session.userId, userId));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("shell-refusal")).toHaveAttribute(
    "data-refusal",
    "unauthorized",
    { timeout: 90_000 },
  );
});

test("access revocation reaches the shell boundary", async ({ page, context }) => {
  const userId = await signInNewUser(context);
  await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await db.update(device).set({ isRevoked: true }).where(eq(device.userId, userId));
  await expect(page.getByTestId("shell-refusal")).toHaveAttribute(
    "data-refusal",
    "access-revoked",
    { timeout: 90_000 },
  );
});
