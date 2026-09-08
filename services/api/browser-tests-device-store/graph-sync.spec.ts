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
 * FDN-51 Stage 4a real-stack proof. Drives the real `LocalGraphClient.startSync`
 * (which runs the `WorkspaceSyncClient` inside the production Worker) against the
 * real `services/sync-engine` relay, the real Postgres this config stands up,
 * the real `/sync/ticket` endpoint, and a real online unlock.
 *
 *  1. single device — a local delta is pushed to the relay and acknowledged,
 *     then after the local store is erased a genuinely fresh Worker replays it
 *     back from the relay and materializes it;
 *  2. two tabs, same device — only one holds the sync connection (the Web
 *     Lock), the other stays offline, and closing the leader hands over with no
 *     ticket thrash and no acknowledgement-row corruption.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple sync 51!";

type SyncState = "offline" | "connecting" | "syncing" | "synced";

declare global {
  interface Window {
    __vultoGraphSyncDiagnostics?: {
      initialize(): Promise<void>;
      eraseLocalStore(workspaceId: string): Promise<void>;
      dispose(): Promise<void>;
      startSync(): Promise<void>;
      stopSync(): Promise<void>;
      getSyncStatus(): {
        state: SyncState;
        pendingLocalChanges: boolean;
        highestKnownCursor: number;
        highestAckedCursor: number;
        lastError: string | null;
      };
      waitForSyncState(state: SyncState, timeoutMs: number): Promise<void>;
      waitForNoPendingLocalChanges(timeoutMs: number): Promise<void>;
      buildUpdateDelta(mapKey: string, value: string): string;
      applyDeltaBatch(
        base64Deltas: readonly string[],
      ): Promise<{ mergedDeltaCount: number }>;
      readPersistedValue(workspaceId: string, mapKey: string): Promise<string | null>;
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn51-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Sync Proof Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<{ id: string }[]>`
    select "id" from "user" where "email" = ${email}`;
  if (!user) throw new Error("sign-up did not create a user");
  return { userId: user.id, cookies: await page.context().cookies(apiOrigin) };
}

async function createWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Sync Proof Co', ${`sync-proof-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${crypto.randomUUID()}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function openUnlocked(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`${webOrigin}/graph-sync-diagnostics?workspaceId=${workspaceId}`);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-sync-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

async function syncTableCounts(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
): Promise<{ deltas: number; acks: number; tickets: number }> {
  const [row] = await sql<{ deltas: number; acks: number; tickets: number }[]>`
    select
      (select count(*)::int from "sync_delta" where "workspace_id" = ${workspaceId}::uuid) as deltas,
      (select count(*)::int from "sync_device_ack" where "workspace_id" = ${workspaceId}::uuid) as acks,
      (select count(*)::int from "sync_ticket" where "workspace_id" = ${workspaceId}::uuid) as tickets`;
  return row;
}

test.describe.configure({ mode: "serial" });

let account: { userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await resetRateLimits(sql);
    account = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-51 Stage 4a — relay sync on the real stack", () => {
  test("pushes a local delta to the relay and replays it into an erased Worker", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addCookies(account.cookies);
      const workspaceId = await createWorkspace(sql, account.userId);
      const page = await context.newPage();

      await openUnlocked(page, workspaceId);

      // 1. Unlock, connect, sync, then push a local mutation.
      await page.evaluate(async () => {
        const api = window.__vultoGraphSyncDiagnostics;
        if (!api) throw new Error("sync diagnostics API missing");
        await api.initialize();
        await api.startSync();
        await api.waitForSyncState("synced", 20_000);
        const merged = await api.applyDeltaBatch([
          api.buildUpdateDelta("greeting", "hello-from-tab-1"),
        ]);
        if (merged.mergedDeltaCount !== 1) {
          throw new Error(`expected one merged delta, got ${merged.mergedDeltaCount}`);
        }
      });

      // The push and its acknowledgement land on the relay's durable log.
      await expect
        .poll(async () => (await syncTableCounts(sql, workspaceId)).deltas, {
          timeout: 15_000,
        })
        .toBe(1);
      const afterPush = await syncTableCounts(sql, workspaceId);
      expect(afterPush.acks, "the device acknowledged it").toBe(1);
      expect(afterPush.tickets, "one sync ticket was minted").toBe(1);
      await page.evaluate(async () => {
        await window.__vultoGraphSyncDiagnostics?.waitForNoPendingLocalChanges(10_000);
      });

      // 2. A genuinely fresh Worker, local store erased, replays it from the relay.
      await page.evaluate(async () => {
        await window.__vultoGraphSyncDiagnostics?.dispose();
      });
      await page.reload();
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("graph-sync-unlocked")).toBeVisible({
        timeout: 20_000,
      });

      const replayed = await page.evaluate(async (id) => {
        const api = window.__vultoGraphSyncDiagnostics;
        if (!api) throw new Error("sync diagnostics API missing");
        await api.eraseLocalStore(id);
        await api.initialize();
        const before = await api.readPersistedValue(id, "greeting");
        await api.startSync();
        await api.waitForSyncState("synced", 20_000);
        await new Promise((r) => setTimeout(r, 700)); // debounced flush
        const after = await api.readPersistedValue(id, "greeting");
        await api.stopSync();
        return { before, after };
      }, workspaceId);

      expect(replayed.before, "the erase removed the local copy").toBeNull();
      expect(
        replayed.after,
        "the relay replayed the delta into the fresh Worker and it materialized",
      ).toBe("hello-from-tab-1");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("two tabs on one device: only one holds the sync connection, and it hands over on close", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addCookies(account.cookies);
      const workspaceId = await createWorkspace(sql, account.userId);

      const tabA = await context.newPage();
      await openUnlocked(tabA, workspaceId);
      await tabA.evaluate(async () => {
        const api = window.__vultoGraphSyncDiagnostics;
        if (!api) throw new Error("sync diagnostics API missing");
        await api.initialize();
        await api.startSync();
        await api.waitForSyncState("synced", 20_000);
      });

      // Same context => same IndexedDB deviceId => same origin Web Lock.
      const tabB = await context.newPage();
      await openUnlocked(tabB, workspaceId);
      const tabBState = await tabB.evaluate(async () => {
        const api = window.__vultoGraphSyncDiagnostics;
        if (!api) throw new Error("sync diagnostics API missing");
        await api.initialize();
        await api.startSync();
        await new Promise((r) => setTimeout(r, 3_000));
        return api.getSyncStatus().state;
      });
      expect(tabBState, "the queued tab stays offline while the other leads").toBe(
        "offline",
      );

      const tabAState = await tabA.evaluate(
        () => window.__vultoGraphSyncDiagnostics!.getSyncStatus().state,
      );
      expect(tabAState, "the leader is still synced").toBe("synced");

      const contended = await syncTableCounts(sql, workspaceId);
      expect(contended.tickets, "only the leader ever minted a ticket").toBe(1);

      // A releases and closes -> its lock frees -> B takes over.
      await tabA.evaluate(() => window.__vultoGraphSyncDiagnostics!.stopSync());
      await tabA.close();

      await tabB.evaluate(async () => {
        const api = window.__vultoGraphSyncDiagnostics;
        if (!api) throw new Error("sync diagnostics API missing");
        await api.waitForSyncState("synced", 20_000);
        await api.stopSync();
      });

      const afterHandover = await syncTableCounts(sql, workspaceId);
      expect(
        afterHandover.acks,
        "the shared ack row was not multiplied by the handover",
      ).toBeLessThanOrEqual(1);

      await tabB.close();
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});
