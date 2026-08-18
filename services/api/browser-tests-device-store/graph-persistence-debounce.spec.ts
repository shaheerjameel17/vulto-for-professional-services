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
 * FDN-50 stage 2: debounced write-through, layered on top of stage 1's
 * SealedStore integration in packages/graph's Worker runtime
 * (packages/graph/src/worker/runtime.ts). Reuses the exact same
 * account/workspace/unlock machinery as graph-persistence.spec.ts (stage 1)
 * and services/api/browser-tests-device-store/device-store.spec.ts rather
 * than inventing a second way to get to an unlocked state. Runs against the
 * same playwright.device-store.config.ts webServer, database, and origins.
 *
 * FLUSH_DEBOUNCE_MS in runtime.ts is 250ms; every wait below is comfortably
 * past that (400ms) so a test never races the debounce timer itself.
 *
 * Decision 2 of this stage (shallow-vs-full snapshot choice) is NOT
 * covered here: it is not shipped. Building it surfaced a reproducible
 * Loro API defect (see runtime.ts's #persist comment and this stage's
 * report), so #persist still writes a full snapshot on every flush, same
 * as stage 1 — only the debounce timing is new.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple graph debounce 50!";
const PAST_DEBOUNCE_WAIT_MS = 400;

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: {
      getStatus(): Promise<{ locked: boolean }>;
      initialize(): Promise<void>;
      lock(): Promise<void>;
      buildSnapshot(mapKey: string, value: string): string;
      applyDeltaBatch(
        base64Snapshots: readonly string[],
      ): Promise<{ mergedDeltaCount: number }>;
      openPayload(storeKey: string): Promise<string | null>;
      readSnapshotValue(base64Snapshot: string, mapKey: string): string | null;
      storeKeyFor(workspaceId: string): string;
      dispose(): Promise<void>;
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn50-debounce-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Graph Debounce Browser");
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
    values (${workspaceId}, 'Graph Debounce Browser Co', ${`graph-debounce-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function unlockAndWait(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Reads the sealed-store payload record's generation counter directly out
 * of IndexedDB, bypassing SealedStore's own API entirely. `put()` reads the
 * existing record, increments its generation, and writes the new one in a
 * single transaction (sealed-store.ts) — so the final generation number is
 * a direct, honest count of how many times `put()` actually committed,
 * independent of anything the runtime or this test claims about itself.
 * IndexedDB is origin-scoped storage, not realm-scoped, so this main-thread
 * read sees exactly what the graph Worker's own realm wrote.
 */
async function readGraphSnapshotGeneration(
  page: Page,
  workspaceId: string,
): Promise<number | null> {
  return page.evaluate((wsId) => {
    return new Promise<number | null>((resolve, reject) => {
      const request = indexedDB.open("vulto-sealed-store", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction("payload", "readonly");
        const compositeKey = `${wsId}:graph-snapshot:${wsId}`;
        const getRequest = tx.objectStore("payload").get(compositeKey);
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
          const record = getRequest.result as { generation: number } | undefined;
          database.close();
          resolve(record ? record.generation : null);
        };
      };
    });
  }, workspaceId);
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

async function openWorkspace(
  browser: import("@playwright/test").Browser,
  sql: ReturnType<typeof postgres>,
): Promise<{
  context: BrowserContext;
  page: Page;
  workspaceId: string;
  storeKey: string;
}> {
  if (!sharedAccount) throw new Error("shared account was not created");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await context.addCookies(sharedAccount.cookies);
  const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await unlockAndWait(page);

  const storeKey = await page.evaluate((id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    return api.storeKeyFor(id);
  }, workspaceId);

  await page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    await api.initialize();
  });

  return { context, page, workspaceId, storeKey };
}

test.describe("FDN-50 stage 2 debounced write-through", () => {
  test("rapid mutations inside one debounce window coalesce into a single durable flush", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openWorkspace(browser, sql);
      context = opened.context;
      const { page, workspaceId } = opened;

      const beforeGeneration = await readGraphSnapshotGeneration(page, workspaceId);
      expect(beforeGeneration).toBeNull();

      // Five mutations fired back-to-back, awaited sequentially inside one
      // page.evaluate call so there is no Playwright round-trip latency
      // between them — the whole burst lands comfortably inside one 250ms
      // debounce window.
      const mergedCounts = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const counts: number[] = [];
        for (let index = 0; index < 5; index += 1) {
          const snapshot = api.buildSnapshot(`burst-${index}`, `value-${index}`);
          const result = await api.applyDeltaBatch([snapshot]);
          counts.push(result.mergedDeltaCount);
        }
        return counts;
      });
      expect(mergedCounts).toEqual([1, 1, 1, 1, 1]);

      // Nothing has been flushed yet: the debounce window from the last of
      // the five mutations is still open.
      const generationImmediatelyAfter = await readGraphSnapshotGeneration(
        page,
        workspaceId,
      );
      expect(generationImmediatelyAfter).toBeNull();

      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      // Generation 0 is the FIRST successful put() — five coalesced
      // mutations produced exactly one flush, not five.
      const generationAfterFlush = await readGraphSnapshotGeneration(page, workspaceId);
      expect(generationAfterFlush).toBe(0);

      // The single flush carries all five mutations' merged state.
      const persisted = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, opened.storeKey);
      expect(persisted).not.toBeNull();
      for (let index = 0; index < 5; index += 1) {
        const value = await page.evaluate(
          ({ base64, mapKey }) => {
            const api = window.__vultoGraphPersistenceDiagnostics;
            if (!api) throw new Error("diagnostics API missing");
            return api.readSnapshotValue(base64, mapKey);
          },
          { base64: persisted!, mapKey: `burst-${index}` },
        );
        expect(value).toBe(`value-${index}`);
      }
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("a mutation persists once the debounce window elapses and survives reopen on a fresh Worker", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openWorkspace(browser, sql);
      context = opened.context;
      const { page, storeKey } = opened;

      const batch = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.buildSnapshot("debounced", "settled");
        return api.applyDeltaBatch([snapshot]);
      });
      expect(batch.mergedDeltaCount).toBe(1);

      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      const persistedBeforeReopen = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(persistedBeforeReopen).not.toBeNull();

      await page.reload();
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      const persistedAfterReopen = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(persistedAfterReopen).not.toBeNull();
      const value = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: persistedAfterReopen!, mapKey: "debounced" },
      );
      expect(value).toBe("settled");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("dispose() called inside the debounce window still flushes the pending mutation", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openWorkspace(browser, sql);
      context = opened.context;
      const { page, storeKey } = opened;

      // Mutate, then dispose immediately — well inside the 250ms debounce
      // window, before the timer would have flushed on its own. dispose()
      // is awaited directly here (not via a page.reload()'s fire-and-forget
      // unmount cleanup), so the Worker's own IndexedDB transaction has
      // definitely committed before this evaluate call resolves.
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.buildSnapshot("torn-down", "still-durable");
        const result = await api.applyDeltaBatch([snapshot]);
        if (result.mergedDeltaCount !== 1) throw new Error("mutation did not apply");
        await api.dispose();
      });

      // A genuinely new Worker instance, per the established reopen
      // pattern: reload mounts a fresh diagnostics client. The old client
      // was already disposed above, so the unmount's own dispose() call is
      // a harmless no-op (BrowserLocalGraphClient.dispose() short-circuits
      // once already disposed).
      await page.reload();
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      const persisted = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(persisted).not.toBeNull();
      const value = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: persisted!, mapKey: "torn-down" },
      );
      expect(value).toBe("still-durable");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
