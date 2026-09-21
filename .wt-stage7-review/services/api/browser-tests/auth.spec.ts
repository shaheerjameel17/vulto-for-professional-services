import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, chromium, type Page } from "@playwright/test";
import postgres from "postgres";

const apiOrigin = "https://localhost:3101";
const databaseUrl =
  process.env.FDN60_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn60_browser";
const password = "Correct horse battery staple browser 60!";

function collectSensitiveKeys(value: unknown, found: string[] = []): string[] {
  const sensitive = new Set([
    "token",
    "sessionToken",
    "accessToken",
    "refreshToken",
    "idToken",
  ]);
  if (Array.isArray(value)) {
    value.forEach((child) => collectSensitiveKeys(child, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (sensitive.has(key)) found.push(key);
      collectSensitiveKeys(child, found);
    }
  }
  return found;
}

async function observeAuthJson(page: Page) {
  const exposed: string[] = [];
  page.on("response", async (response) => {
    if (!response.url().startsWith(`${apiOrigin}/api/auth/`)) return;
    if (!response.headers()["content-type"]?.includes("application/json")) return;
    try {
      collectSensitiveKeys(await response.json(), exposed);
    } catch {
      // Redirects and empty responses do not have JSON bodies to inspect.
    }
  });
  return exposed;
}

test("email/password survives a real browser restart and revocation wins", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn60-profile-"));
  const email = `browser-${crypto.randomUUID()}@example.com`;
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    let context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ignoreHTTPSErrors: true,
    });
    let page = context.pages()[0] ?? (await context.newPage());
    const exposed = await observeAuthJson(page);

    await page.goto("https://localhost:3100/sign-up");
    await page.getByLabel("Name").fill("Browser Restart");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
    expect(exposed).toEqual([]);

    const cookie = (await context.cookies(apiOrigin)).find((candidate) =>
      candidate.name.includes("session_token"),
    );
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      domain: "localhost",
    });
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
    expect(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
    ).toEqual({ local: [], session: [] });

    await context.close();

    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ignoreHTTPSErrors: true,
    });
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://localhost:3100/auth-ready");
    await expect(page.getByText(email)).toBeVisible();

    await sql`delete from "session" where "user_id" = (
      select "id" from "user" where "email" = ${email}
    )`;
    await page.reload();
    await expect(page.getByText("Your session is not available.")).toBeVisible();
    await context.close();
  } finally {
    await sql.end();
    await rm(profile, { recursive: true, force: true });
  }
});

test("real Chromium performs passkey-first registration, sign-in, and rejects replay", async ({
  page,
  context,
}) => {
  const email = `passkey-${crypto.randomUUID()}@example.com`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  let registrationContext = "";
  let verificationBody = "";
  const exposed = await observeAuthJson(page);
  page.on("response", async (response) => {
    if (response.url().endsWith("/passkey/registration-context") && response.ok()) {
      registrationContext = ((await response.json()) as { context: string }).context;
    }
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/passkey/verify-registration")) {
      verificationBody = request.postData() ?? "";
    }
  });

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Passkey Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  expect(registrationContext).not.toBe("");
  expect(verificationBody).not.toBe("");
  expect(exposed).toEqual([]);

  const replay = await page.evaluate(
    async ({ origin, body }) => {
      const response = await fetch(`${origin}/api/auth/passkey/verify-registration`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body,
      });
      return response.status;
    },
    { origin: apiOrigin, body: verificationBody },
  );
  expect(replay).toBeGreaterThanOrEqual(400);

  await page.getByRole("button", { name: "Sign out" }).click();
  // Wait for the server to actually agree the session is gone, not merely for
  // the click to dispatch. generate-register-options runs with
  // `requireSession: false`, which makes a session OPTIONAL rather than
  // ignored: while one is still live the passkey plugin derives identity from
  // it and never consults the registration context at all, so the reuse check
  // below returns 200 on a context the database has already marked consumed.
  // Asserting on the signed-out UI alone would not close this — the redirect
  // can land before the session row is gone. Recorded as F123.
  await expect
    .poll(
      async () =>
        page.evaluate(async (origin) => {
          const response = await fetch(`${origin}/api/auth/get-session`, {
            credentials: "include",
          });
          const body = (await response.text()).trim();
          return body === "" || body === "null";
        }, apiOrigin),
      { timeout: 15_000 },
    )
    .toBe(true);

  const reusedContext = await page.evaluate(
    async ({ origin, registrationContext }) => {
      const response = await fetch(
        `${origin}/api/auth/passkey/generate-register-options?context=${encodeURIComponent(registrationContext)}`,
        { credentials: "include" },
      );
      return response.status;
    },
    { origin: apiOrigin, registrationContext },
  );
  expect(reusedContext).toBe(400);

  await page.getByRole("button", { name: "Use passkey" }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
});
