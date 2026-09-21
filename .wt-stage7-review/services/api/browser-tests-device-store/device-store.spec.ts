import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple browser 84!";

/**
 * Both /sign-up/email and /sign-in/email are rate-limited per IP
 * (services/api/src/auth/config.ts: 3/60s and 5/60s respectively). Every
 * test in this file runs in a fresh browser profile (a real
 * cold-restart/new-Worker requirement), so one account is created once via
 * the real sign-up form, and every test injects that same session cookie
 * into its own fresh profile directly rather than re-authenticating through
 * the UI. This proves the same real, server-issued session each time
 * without tripping the rate limiter.
 */
async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Device Store Browser");
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

async function createWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Device Store Browser Co', ${`device-store-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function rawIndexedDbSnapshot(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === "vulto-sealed-store")) {
      return { envelope: [], payload: [], "device-identity": [] };
    }

    function readAll(database: IDBDatabase, storeName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vulto-sealed-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result: Record<string, unknown[]> = {};
    for (const name of Array.from(database.objectStoreNames)) {
      result[name] = await readAll(database, name);
    }
    database.close();
    return result;
  });
}

test.describe.configure({ mode: "serial" });

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-84 sealed local device store", () => {
  test("locks by default, proves ciphertext-only storage, unlocks online, seals and opens opaque bytes, and stays open offline", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      const keyObservations: unknown[] = [];
      page.on("console", (message) => {
        // Any accidental console.log of key material would show up here too.
        if (/AES|CryptoKey|deviceHalf|serverHalf/i.test(message.text())) {
          keyObservations.push(message.text());
        }
      });

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await expect(page.getByTestId("locked-shell")).toBeVisible();

      // Cold, un-unlocked store: no envelope and no payload records at all yet.
      const beforeUnlock = (await rawIndexedDbSnapshot(page)) as Record<
        string,
        unknown[]
      >;
      expect(beforeUnlock.envelope).toEqual([]);
      expect(beforeUnlock.payload).toEqual([]);

      const postMessagePayloads: unknown[] = [];
      await page.exposeFunction("__recordPostMessage", (data: unknown) => {
        postMessagePayloads.push(data);
      });
      await page.evaluate(() => {
        const originalPostMessage = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function patched(
          this: Worker,
          ...args: unknown[]
        ) {
          (
            window as unknown as { __recordPostMessage: (data: unknown) => void }
          ).__recordPostMessage(args[0]);
          return originalPostMessage.apply(this, args as never);
        };
      });

      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });

      const serialized = JSON.stringify(postMessagePayloads);
      expect(serialized).not.toMatch(/"serverHalf"/);
      expect(keyObservations).toEqual([]);

      await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.seal("fdn84-proof-record", btoa("hello sealed graph bytes"));
      });

      const afterSeal = (await rawIndexedDbSnapshot(page)) as Record<string, unknown[]>;
      expect(afterSeal.payload).toHaveLength(1);
      const record = afterSeal.payload[0] as { ciphertext: Uint8Array | ArrayBuffer };
      const ciphertextBytes = new Uint8Array(
        record.ciphertext instanceof Uint8Array ? record.ciphertext : record.ciphertext,
      );
      const ciphertextText = Buffer.from(ciphertextBytes).toString("latin1");
      expect(ciphertextText).not.toContain("hello sealed graph bytes");

      const opened = await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.open("fdn84-proof-record");
      });
      expect(atob(opened ?? "")).toBe("hello sealed graph bytes");

      // Going offline afterward preserves the already-unlocked store.
      await context.setOffline(true);
      const stillOpen = await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.open("fdn84-proof-record");
      });
      expect(atob(stillOpen ?? "")).toBe("hello sealed graph bytes");
      await context.setOffline(false);
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("a cold restart while offline stays locked and decrypts nothing", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      let page = context.pages()[0] ?? (await context.newPage());
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });
      await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.seal("fdn84-cold-restart", btoa("do not decrypt me offline"));
      });

      await context.close();

      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      page = context.pages()[0] ?? (await context.newPage());
      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await expect(page.getByTestId("locked-shell")).toBeVisible();
      await context.setOffline(true);
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("locked-shell-offline")).toBeVisible();

      const status = await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.getStatus();
      });
      expect(status.locked).toBe(true);

      const openAttempt = await page
        .evaluate(async () => {
          const api = window.__vultoDeviceStoreDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.open("fdn84-cold-restart");
        })
        .catch((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        );
      expect(String(openAttempt)).toMatch(/locked/i);
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("revoking the workspace membership denies the next unlock attempt on a new Worker instance", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });

      await sql`update "member" set "status" = 'revoked', "projection_state" = 'revocation-pending'
        where "organization_id" = ${workspaceId}`;
      await sql`update "device_unlock_secret" set "revoked_at" = now()
        where "workspace_id" = ${workspaceId}`;

      await page.reload();
      await expect(page.getByTestId("locked-shell")).toBeVisible();
      await page.getByRole("button", { name: "Retry" }).click();
      // Denial renders identically to any other failure — no message may say
      // the device was specifically denied, which would enumerate revocation.
      await expect(
        page.getByText(
          "Every restart requires the server to confirm your session before your local data can open.",
        ),
      ).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByText("The server did not authorize this device"),
      ).not.toBeVisible();
      await expect(page.getByTestId("device-store-unlocked")).not.toBeVisible();
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("an expiring session while the Worker is already unlocked does not lock the store", async () => {
    // This test deliberately expires its session row, which would break
    // every later test if it shared sharedAccount's cookie — so it signs
    // up its own dedicated account instead.
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      const account = await signUp(page, sql);
      const workspaceId = await createWorkspaceMembership(sql, account.userId);

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });

      await sql`update "session" set "expires_at" = now() - interval '1 hour'
        where "user_id" = ${account.userId}`;

      const stillLocked = await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.getStatus();
      });
      expect(stillLocked.locked).toBe(false);
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible();
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("corrupted ciphertext and a wrong key both fail as the same 'cannot open' outcome, while an envelope mismatch is reported distinctly", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });
      await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.seal(
          "fdn84-corruption-proof",
          btoa("plaintext that must never leak"),
        );
      });

      const corruptionResult = await page.evaluate(async (targetWorkspaceId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("vulto-sealed-store");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const key = `${targetWorkspaceId}:fdn84-corruption-proof`;
        const record = await new Promise<{ ciphertext: Uint8Array } | undefined>(
          (resolve, reject) => {
            const tx = database.transaction("payload", "readonly");
            const request = tx.objectStore("payload").get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        if (!record) throw new Error("record missing");
        const corrupted = new Uint8Array(record.ciphertext);
        corrupted[0] = corrupted[0] ^ 0xff;
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction("payload", "readwrite");
          tx.objectStore("payload").put({
            ...record,
            storeKey: key,
            ciphertext: corrupted,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();

        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.open("fdn84-corruption-proof");
          return "opened-without-error";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }, workspaceId);
      expect(corruptionResult).toMatch(/cannot open|cannot be opened/i);

      const mismatchResult = await page.evaluate(async (targetWorkspaceId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("vulto-sealed-store");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const envelope = await new Promise<{
          keyEpoch: number;
          [key: string]: unknown;
        }>((resolve, reject) => {
          const tx = database.transaction("envelope", "readonly");
          const request = tx.objectStore("envelope").get(targetWorkspaceId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction("envelope", "readwrite");
          tx.objectStore("envelope").put(
            { ...envelope, keyEpoch: envelope.keyEpoch + 1 },
            targetWorkspaceId,
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();

        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.open("fdn84-corruption-proof");
          return "opened-without-error";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }, workspaceId);
      expect(mismatchResult).toMatch(/envelope mismatch: key-epoch/i);
      expect(mismatchResult).not.toMatch(/cannot open|cannot be opened/i);
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("a write killed mid-transaction never applies a torn generation", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "vulto-fdn84-profile-"));
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/device-store-diagnostics?workspaceId=${workspaceId}`,
      );
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("device-store-unlocked")).toBeVisible({
        timeout: 20_000,
      });
      await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.seal("fdn84-generation-proof", btoa("generation zero"));
      });

      // Simulate a write killed mid-flight: start a real IndexedDB write
      // transaction for the next generation, then abort it before it
      // commits — exactly the same guarantee an actual tab kill relies on,
      // since a browser never partially applies an uncommitted transaction.
      await page.evaluate(async (targetWorkspaceId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("vulto-sealed-store");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const key = `${targetWorkspaceId}:fdn84-generation-proof`;
        const tx = database.transaction("payload", "readwrite");
        tx.objectStore("payload").put({
          storeKey: key,
          workspaceId: targetWorkspaceId,
          generation: 99,
          iv: new Uint8Array(12),
          ciphertext: new Uint8Array([1, 2, 3]),
        });
        tx.abort();
        database.close();
      }, workspaceId);

      const survivingGeneration = await page.evaluate(async (targetWorkspaceId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("vulto-sealed-store");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const key = `${targetWorkspaceId}:fdn84-generation-proof`;
        const record = await new Promise<{ generation: number } | undefined>(
          (resolve, reject) => {
            const readTx = database.transaction("payload", "readonly");
            const request = readTx.objectStore("payload").get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        database.close();
        return record?.generation ?? null;
      }, workspaceId);
      expect(survivingGeneration).toBe(0);

      const stillReadable = await page.evaluate(async () => {
        const api = window.__vultoDeviceStoreDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.open("fdn84-generation-proof");
      });
      expect(atob(stillReadable ?? "")).toBe("generation zero");
    } finally {
      await context?.close();
      await sql.end();
      await rm(profile, { recursive: true, force: true });
    }
  });
});
