import {
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

/**
 * FDN-50 stage 1: SealedStore integration in packages/graph's Worker
 * runtime. Proves persist-on-mutation and reopen-on-initialize against the
 * real production Worker (packages/graph/src/worker/entry.ts, driven
 * through its real protocol), the real FDN-84 sealed store, and a real
 * online unlock — reusing exactly the same account/workspace/unlock
 * machinery as services/api/browser-tests-device-store/device-store.spec.ts
 * rather than inventing a second way to get there. Runs against the same
 * playwright.device-store.config.ts webServer, database, and origins.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple graph persist 50!";

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
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn50-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Graph Persistence Browser");
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
    values (${workspaceId}, 'Graph Persistence Browser Co', ${`graph-persistence-${workspaceId}`}, now(), 'active')`;
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

test.describe.configure({ mode: "serial" });

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-50 stage 1 graph persistence", () => {
  test("persists a mutation and reopens it on a genuinely new Worker instance", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
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

      // 3. A workspace that has never been persisted before initializes
      // cleanly and nothing exists under its key yet.
      const beforeMutation = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(beforeMutation).toBeNull();

      // 1. Mutate via the test-only technique (a synthetic Loro snapshot fed
      // through the real, already-existing applyDeltaBatch entrypoint — see
      // packages/graph/browser-tests/main-thread-responsiveness.spec.ts for
      // the established precedent) and confirm persist landed.
      const firstBatch = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.buildSnapshot("original", "hello-stage1");
        return api.applyDeltaBatch([snapshot]);
      });
      expect(firstBatch.mergedDeltaCount).toBe(1);

      // FDN-50 stage 2: the flush is now debounced (250ms in runtime.ts), so
      // this waits comfortably past that window before checking persistence
      // — applyDeltaBatch resolving no longer means the write has landed.
      await page.waitForTimeout(400);

      const persistedAfterFirstBatch = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(persistedAfterFirstBatch).not.toBeNull();
      expect(persistedAfterFirstBatch!.length).toBeGreaterThan(0);

      const decodedOriginal = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: persistedAfterFirstBatch!, mapKey: "original" },
      );
      expect(decodedOriginal).toBe("hello-stage1");

      // 2. Fully dispose the runtime/Worker (a real page reload unmounts the
      // React component, which disposes the client and terminates the real
      // Worker) and construct a genuinely new one against the same profile.
      await page.reload();
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      // Prove the mutation from step 1 is present in the freshly-imported
      // document, not merely in the sealed bytes on disk: merge a SECOND,
      // independent mutation on top of the reopened document and persist
      // again. If initialize() had failed to import the first snapshot, the
      // final merged snapshot would be missing "original" even though
      // "after-reopen" would still be present.
      const secondBatch = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.buildSnapshot("after-reopen", "confirmed");
        return api.applyDeltaBatch([snapshot]);
      });
      expect(secondBatch.mergedDeltaCount).toBe(1);

      // Same debounce-aware wait as above, before reading persisted state.
      await page.waitForTimeout(400);

      const finalPersisted = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(finalPersisted).not.toBeNull();

      const finalOriginal = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: finalPersisted!, mapKey: "original" },
      );
      const finalAfterReopen = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: finalPersisted!, mapKey: "after-reopen" },
      );
      expect(finalOriginal).toBe("hello-stage1");
      expect(finalAfterReopen).toBe("confirmed");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("initializing while the sealed store is locked fails cleanly", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      // Deliberately never click Retry: this Worker instance stays locked.
      await expect(page.getByTestId("locked-shell")).toBeVisible();

      const status = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.getStatus();
      });
      expect(status.locked).toBe(true);

      const initializeAttempt = await page
        .evaluate(async () => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          await api.initialize();
        })
        .then(() => "succeeded")
        .catch((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        );
      expect(initializeAttempt).not.toBe("succeeded");
      expect(String(initializeAttempt)).toMatch(/locked/i);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("applying a delta batch while the sealed store is locked fails cleanly once its deferred flush is observed", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

      await page.goto(
        `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
      );
      await unlockAndWait(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.initialize();
      });

      const storeKey = await page.evaluate((id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.storeKeyFor(id);
      }, workspaceId);

      // Lock the store on this already-initialized Worker instance, then
      // attempt a mutation. FDN-50 stage 2: the document import (and the
      // in-memory mutation it produces) is no longer coupled to the persist
      // step — applyDeltaBatch itself succeeds here, per the debounced
      // write-through design (the 16ms optimistic write-acknowledgment
      // budget: in-memory apply is never delayed or blocked by durability).
      // The persist attempt is scheduled but not awaited by this call.
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.lock();
      });

      const applyResult = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        const snapshot = api.buildSnapshot("should-not-persist", "never");
        return api.applyDeltaBatch([snapshot]);
      });
      expect(applyResult.mergedDeltaCount).toBe(1);

      // Wait past the debounce window: the scheduled flush now fires,
      // finds the store locked, and fails. That failure is captured
      // (runtime.ts's #pendingFlushError) rather than thrown into a void,
      // and surfaces on the next call into the runtime — here, dispose().
      await page.waitForTimeout(400);

      const disposeAttempt = await page
        .evaluate(async () => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          await api.dispose();
        })
        .then(() => "succeeded")
        .catch((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        );
      expect(disposeAttempt).not.toBe("succeeded");
      expect(String(disposeAttempt)).toMatch(/locked/i);

      // Confirm nothing was ever persisted under this workspace's key: the
      // locked write never silently succeeded with data. The Worker that
      // attempted the write was torn down by the fatal error above (per
      // client.ts's protocol handling), so this reads it back through a
      // brand new page/Worker pair — a real online unlock, exactly like the
      // first test's reopen step.
      await page.reload();
      await unlockAndWait(page);
      const persistedAfterFailedWrite = await page.evaluate(async (key) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.openPayload(key);
      }, storeKey);
      expect(persistedAfterFailedWrite).toBeNull();
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
