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
  apiDirect,
  cacheName,
  createOwnedWorkspace,
  db,
  signInNewUser,
  webOrigin,
} from "./helpers.js";

const copy =
  "Reconnect to continue. Vulto needs to verify your session before opening your workspace.";
const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

test("a real no-session answer goes to sign-in before Reconnect", async ({ page }) => {
  await page.goto(webOrigin);
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
  await expect(page.getByText(copy)).toHaveCount(0);
});

test("a cold 401 session answer goes to sign-in before any workspace call", async ({
  page,
}) => {
  let refused = 0;
  const workspaceCalls: string[] = [];
  await page.route("**/api/auth/get-session", async (route) => {
    refused += 1;
    await route.fulfill({ status: 401, body: "Unauthorized" });
  });
  page.on("request", (request) => {
    if (/\/workspace\/|\/v1\/shape|\/devices\/register/.test(request.url()))
      workspaceCalls.push(request.url());
  });
  await page.goto(webOrigin);
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
  expect(refused).toBeGreaterThan(0);
  expect(workspaceCalls).toEqual([]);
  await expect(page.getByText(copy)).toHaveCount(0);
});

test("a prior session refused with 401 shows Reconnect, keeps its cache, and Retry recovers", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await db.delete(session).where(eq(session.userId, userId));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(copy)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      indexedDB.databases().then((items) => items.map((item) => item.name)),
    ),
  ).toContain(cacheName(workspaceId, userId));

  const signIn = await context.request.post(`${apiDirect}/api/auth/sign-in/email`, {
    headers: { origin: webOrigin },
    data: { email: account!.email, password: PASSWORD },
    ignoreHTTPSErrors: true,
  });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(copy)).toHaveCount(0);
});

test("access revocation renders the same Reconnect state and erases the workspace cache", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await db.update(device).set({ isRevoked: true }).where(eq(device.userId, userId));
  await expect(page.getByText(copy)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() =>
        indexedDB.databases().then((items) => items.map((item) => item.name)),
      ),
    )
    .not.toContain(cacheName(workspaceId, userId));

  const midSessionState = await page
    .locator("main")
    .evaluate((element) => element.outerHTML);
  // A cold shell load after the refusal has exactly the same view.
  await page.reload();
  await expect(page.getByText(copy)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await page.locator("main").evaluate((element) => element.outerHTML)).toBe(
    midSessionState,
  );
  const retriedSession = page.waitForResponse((response) =>
    response.url().includes("/api/auth/get-session"),
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await retriedSession;
  await expect(page.getByText(copy)).toBeVisible({ timeout: 90_000 });
});

test("a genuine network outage remains Offline and never shows Reconnect", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  network.cut();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(copy)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible();
});

for (const status of [503, 429]) {
  test(`a session-refresh ${status} leaves an already open shell in place`, async ({
    page,
    context,
  }) => {
    const userId = await signInNewUser(context);
    await createOwnedWorkspace(userId);
    await page.goto(webOrigin);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status, body: "Unavailable" }),
    );
    const response = page.waitForResponse(
      (item) =>
        item.url().includes("/api/auth/get-session") && item.status() === status,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await response;
    await expect(
      page.getByRole("button", { name: "Open Sync Browser Co menu" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(copy)).toHaveCount(0);
  });
}

test("a session-refresh timeout leaves an already open shell in place", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  await createOwnedWorkspace(userId);
  await page.goto(webOrigin);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.route("**/api/auth/get-session", (route) => route.abort("timedout"));
  const failed = page.waitForEvent("requestfailed", (request) =>
    request.url().includes("/api/auth/get-session"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await failed;
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(copy)).toHaveCount(0);
});
