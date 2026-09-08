import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * FDN-51 Stage 4a + 4b real-stack proof. Drives the real
 * `LocalGraphClient.startSync` (which runs the `WorkspaceSyncClient` inside the
 * production Worker) against the real `services/sync-engine` relay, the real
 * Postgres this config stands up, the real `/sync/ticket` endpoint, and a real
 * online unlock.
 *
 * Stage 4a — one device:
 *  1. a local delta is pushed to the relay and acknowledged, then after the
 *     local store is erased a genuinely fresh Worker replays it back from the
 *     relay and materializes it;
 *  2. two tabs, same device — only one holds the sync connection (the Web
 *     Lock), the other stays offline, and closing the leader hands over with no
 *     ticket thrash and no acknowledgement-row corruption.
 *
 * Stage 4b — two (or three) independent devices, each a separate Playwright
 * `BrowserContext` so each has its own IndexedDB `deviceId`, its own
 * `device_unlock_secret` row, its own `sync_ticket`, its own `sync_device_ack`
 * row, and its own in-memory `LoroDoc` replica (distinct Loro peer). All
 * against one relay + one Postgres, one user, one workspace:
 *  3. concurrent offline non-conflicting edits converge to the union;
 *  4. concurrent offline edits to the SAME field converge to one value on both
 *     replicas (Loro's own resolution — the test asserts replica equality and
 *     stability, never a specific winner), neither replica left diverged;
 *  5. a device receives a peer's live pushes while replaying its own backlog
 *     larger than one relay page — every delta applied once, in order, gapless;
 *  6. a device offline across an extended multi-page gap catches up fully;
 *  7. duplicate / replayed delivery is idempotent across replicas;
 *  8. a cold third device bootstraps by plain replay from cursor zero.
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

// --- Stage 4b helpers: one independent device per browser context ----------

/**
 * A fresh browser context signed in as the shared account. A separate context
 * has its own IndexedDB, so its `SealedStore` generates its own `deviceId` and
 * its online unlock provisions its own `device_unlock_secret` row — a genuine
 * second device of the same user, not a second view of the first.
 */
async function newDeviceContext(browser: Browser): Promise<BrowserContext> {
  if (!account) throw new Error("no account");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies(account.cookies);
  return context;
}

/**
 * Open the diagnostics page for a device and initialize its Worker. By default
 * it also starts syncing and waits for the first `synced` — a local write only
 * enters the sync outbox once `startSync` has run, so tests that then edit
 * "offline" drop the network (see `editWhileOffline`) rather than never
 * starting sync. Pass `{ sync: false }` for a device that must stay
 * disconnected while a peer builds a backlog.
 */
async function openDevice(
  context: BrowserContext,
  workspaceId: string,
  opts: { sync?: boolean } = {},
): Promise<Page> {
  const page = await context.newPage();
  await openUnlocked(page, workspaceId);
  await page.evaluate(async (sync) => {
    const api = window.__vultoGraphSyncDiagnostics!;
    await api.initialize();
    if (sync) {
      await api.startSync();
      await api.waitForSyncState("synced", 45_000);
    }
  }, opts.sync ?? true);
  return page;
}

/** Apply one or more local map writes offline (or online) on this replica. */
async function applyLocalWrites(
  page: Page,
  entries: readonly (readonly [string, string])[],
): Promise<void> {
  await page.evaluate(
    async (pairs) => {
      const api = window.__vultoGraphSyncDiagnostics!;
      await api.applyDeltaBatch(
        pairs.map(([key, value]) => api.buildUpdateDelta(key, value)),
      );
    },
    entries as [string, string][],
  );
}

/** Start syncing and wait until the replica is caught up and has nothing pending. */
async function syncUntilQuiet(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.evaluate(async (timeout) => {
    const api = window.__vultoGraphSyncDiagnostics!;
    await api.startSync();
    await api.waitForSyncState("synced", timeout);
    await api.waitForNoPendingLocalChanges(timeout);
    await api.waitForSyncState("synced", timeout);
  }, timeoutMs);
}

/**
 * Make each device drop its relay connection (network offline), apply local
 * writes into its durable sync outbox while disconnected, then come back
 * online — the concurrent-offline-edit shape. Each device must already be
 * syncing (its outbox only captures writes once `startSync` has run).
 */
async function editWhileOffline(
  devices: readonly {
    context: BrowserContext;
    page: Page;
    writes: readonly (readonly [string, string])[];
  }[],
): Promise<void> {
  for (const d of devices) await d.context.setOffline(true);
  // Let the sockets actually close before writing.
  for (const d of devices) {
    await d.page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  }
  for (const d of devices) await applyLocalWrites(d.page, d.writes);
  for (const d of devices) await d.context.setOffline(false);
}

async function syncStatus(page: Page): Promise<{
  state: string;
  pendingLocalChanges: boolean;
  highestKnownCursor: number;
  highestAckedCursor: number;
}> {
  return page.evaluate(() => {
    const s = window.__vultoGraphSyncDiagnostics!.getSyncStatus();
    return {
      state: s.state,
      pendingLocalChanges: s.pendingLocalChanges,
      highestKnownCursor: s.highestKnownCursor,
      highestAckedCursor: s.highestAckedCursor,
    };
  });
}

/** Poll until this replica has durably acknowledged a gapless prefix reaching `target`. */
async function waitForAckedCursor(
  page: Page,
  target: number,
  timeoutMs = 45_000,
): Promise<void> {
  await expect
    .poll(async () => (await syncStatus(page)).highestAckedCursor, {
      timeout: timeoutMs,
      message: `acked cursor >= ${target}`,
    })
    .toBeGreaterThanOrEqual(target);
}

/** Read one map key out of this replica's flushed sealed snapshot. */
async function readReplicaValue(
  page: Page,
  workspaceId: string,
  key: string,
): Promise<string | null> {
  return page.evaluate(
    ({ id, mapKey }) =>
      window.__vultoGraphSyncDiagnostics!.readPersistedValue(id, mapKey),
    { id: workspaceId, mapKey: key },
  );
}

/**
 * Poll until every named replica reports `key === value` in its own flushed
 * snapshot. Asserts convergence without depending on flush timing.
 */
async function expectAllConverged(
  replicas: readonly { page: Page; label: string }[],
  workspaceId: string,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  for (const { page, label } of replicas) {
    for (const [key, value] of Object.entries(expected)) {
      await expect
        .poll(() => readReplicaValue(page, workspaceId, key), {
          timeout: 30_000,
          message: `${label}: ${key}`,
        })
        .toBe(value);
    }
  }
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

      // The push and its acknowledgement land on the relay's durable log. The
      // `Ack{ClientCumulative}` is a round-trip after the `RelayReceipt`, so the
      // ack row lands slightly after the delta row — poll it rather than
      // reading once.
      await expect
        .poll(async () => (await syncTableCounts(sql, workspaceId)).deltas, {
          timeout: 15_000,
        })
        .toBe(1);
      await expect
        .poll(async () => (await syncTableCounts(sql, workspaceId)).acks, {
          timeout: 15_000,
          message: "the device acknowledged the delta",
        })
        .toBe(1);
      const afterPush = await syncTableCounts(sql, workspaceId);
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

test.describe("FDN-51 Stage 4b — two-device convergence on the real stack", () => {
  test("concurrent offline non-conflicting edits converge to the union", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      const deviceA = await openDevice(contextA, workspaceId);
      const deviceB = await openDevice(contextB, workspaceId);

      // Both are online and settled (openDevice). Edit concurrently while
      // offline (distinct keys), then reconnect.
      await editWhileOffline([
        { context: contextA, page: deviceA, writes: [["alpha", "a1"]] },
        { context: contextB, page: deviceB, writes: [["beta", "b1"]] },
      ]);

      // Each replica pushes its own edit and receives the other's over the
      // live doorbell, durably acknowledging the full prefix (cursor 2).
      await waitForAckedCursor(deviceA, 2);
      await waitForAckedCursor(deviceB, 2);

      await expectAllConverged(
        [
          { page: deviceA, label: "device A" },
          { page: deviceB, label: "device B" },
        ],
        workspaceId,
        { alpha: "a1", beta: "b1" },
      );

      const counts = await syncTableCounts(sql, workspaceId);
      expect(counts.deltas, "exactly the two authored deltas reached the log").toBe(2);
      expect(counts.acks, "one durable ack row per device").toBe(2);
      expect(counts.tickets, "one ticket per device").toBe(2);

      for (const page of [deviceA, deviceB]) {
        const status = await syncStatus(page);
        expect(status.highestAckedCursor, "acked up to the head").toBe(2);
        expect(status.highestKnownCursor).toBe(2);
      }
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  test("concurrent offline edits to the same field converge to one value on both replicas", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      const deviceA = await openDevice(contextA, workspaceId);
      const deviceB = await openDevice(contextB, workspaceId);

      await editWhileOffline([
        { context: contextA, page: deviceA, writes: [["greeting", "from-device-A"]] },
        { context: contextB, page: deviceB, writes: [["greeting", "from-device-B"]] },
      ]);

      await waitForAckedCursor(deviceA, 2);
      await waitForAckedCursor(deviceB, 2);

      // Wait for A's flushed snapshot to hold a resolved value, then require B
      // to converge to exactly it.
      let settledA: string | null = null;
      await expect
        .poll(
          async () => {
            settledA = await readReplicaValue(deviceA, workspaceId, "greeting");
            return settledA;
          },
          { timeout: 30_000, message: "device A resolved 'greeting'" },
        )
        .not.toBeNull();
      await expect
        .poll(() => readReplicaValue(deviceB, workspaceId, "greeting"), {
          timeout: 30_000,
          message: "device B converges to A's value",
        })
        .toBe(settledA);

      // The value is one of the two writes — Loro resolved it, not this test —
      // and neither replica is stranded on the other value.
      expect(["from-device-A", "from-device-B"]).toContain(settledA);

      // Stability: an unrelated edit + another sync round must not disturb it.
      await applyLocalWrites(deviceA, [["unrelated", "x"]]);
      await syncUntilQuiet(deviceA);
      await syncUntilQuiet(deviceB);
      await waitForAckedCursor(deviceB, 3);
      await expectAllConverged(
        [
          { page: deviceA, label: "device A" },
          { page: deviceB, label: "device B" },
        ],
        workspaceId,
        { greeting: settledA!, unrelated: "x" },
      );
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  test("a device applies a peer's live pushes while replaying its own backlog larger than one page", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      // A stays disconnected while B builds the backlog.
      const deviceA = await openDevice(contextA, workspaceId, { sync: false });
      const deviceB = await openDevice(contextB, workspaceId);

      // B seeds a backlog larger than one relay page (MAX_DELTA_PAGE = 500).
      const BACKLOG = 520;
      const backlog: [string, string][] = Array.from({ length: BACKLOG }, (_, i) => [
        `k${i}`,
        `v${i}`,
      ]);
      await applyLocalWrites(deviceB, backlog);
      await syncUntilQuiet(deviceB, 120_000);
      await expect
        .poll(async () => (await syncTableCounts(sql, workspaceId)).deltas, {
          timeout: 90_000,
        })
        .toBe(BACKLOG);

      // A starts replaying; before it finishes, B pushes more live deltas.
      await deviceA.evaluate(async () => {
        await window.__vultoGraphSyncDiagnostics!.startSync();
      });
      const live: [string, string][] = Array.from({ length: 15 }, (_, i) => [
        `live${i}`,
        `lv${i}`,
      ]);
      await applyLocalWrites(deviceB, live);

      await syncUntilQuiet(deviceB, 120_000);
      await deviceA.evaluate(() =>
        window.__vultoGraphSyncDiagnostics!.waitForSyncState("synced", 120_000),
      );

      const total = BACKLOG + live.length;
      await expect
        .poll(async () => (await syncTableCounts(sql, workspaceId)).deltas, {
          timeout: 60_000,
        })
        .toBe(total);

      // Every delta reached A exactly once, gaplessly, and it converged with B.
      const expected: Record<string, string> = {
        k0: "v0",
        [`k${BACKLOG - 1}`]: `v${BACKLOG - 1}`,
        live0: "lv0",
        [`live${live.length - 1}`]: `lv${live.length - 1}`,
      };
      await expectAllConverged(
        [
          { page: deviceA, label: "device A" },
          { page: deviceB, label: "device B" },
        ],
        workspaceId,
        expected,
      );

      const statusA = await syncStatus(deviceA);
      expect(
        statusA.highestAckedCursor,
        "A acked a gapless prefix up to the head",
      ).toBe(total);
      expect(statusA.highestKnownCursor).toBe(total);
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  test("a device offline across an extended multi-page gap catches up fully on return", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      const deviceA = await openDevice(contextA, workspaceId);
      const deviceB = await openDevice(contextB, workspaceId);

      // A syncs once, then goes offline.
      await applyLocalWrites(deviceA, [["origin", "from-A"]]);
      await syncUntilQuiet(deviceA);
      await syncUntilQuiet(deviceB);
      await deviceA.evaluate(() => window.__vultoGraphSyncDiagnostics!.stopSync());
      const ackBeforeGap = (await syncStatus(deviceA)).highestAckedCursor;

      // B works an extended session — several batches spanning > one page.
      for (let round = 0; round < 6; round += 1) {
        const batch: [string, string][] = Array.from({ length: 100 }, (_, i) => [
          `r${round}n${i}`,
          `r${round}v${i}`,
        ]);
        await applyLocalWrites(deviceB, batch);
      }
      await syncUntilQuiet(deviceB, 120_000);
      const head = (await syncTableCounts(sql, workspaceId)).deltas;
      expect(head).toBe(1 + 600);

      // A returns after the gap.
      await syncUntilQuiet(deviceA, 120_000);

      const statusA = await syncStatus(deviceA);
      expect(
        statusA.highestAckedCursor,
        "A caught up gaplessly from its pre-gap ack to the head",
      ).toBe(head);
      expect(statusA.highestAckedCursor).toBeGreaterThan(ackBeforeGap);

      await expectAllConverged(
        [
          { page: deviceA, label: "device A" },
          { page: deviceB, label: "device B" },
        ],
        workspaceId,
        { origin: "from-A", r0n0: "r0v0", r5n99: "r5v99" },
      );
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  test("replayed delivery is idempotent: an erased replica rebuilds the converged state without new deltas", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      const deviceA = await openDevice(contextA, workspaceId);
      const deviceB = await openDevice(contextB, workspaceId);

      await applyLocalWrites(deviceA, [
        ["one", "1"],
        ["two", "2"],
      ]);
      await applyLocalWrites(deviceB, [["three", "3"]]);
      await syncUntilQuiet(deviceA);
      await syncUntilQuiet(deviceB);
      await syncUntilQuiet(deviceA);

      const converged = { one: "1", two: "2", three: "3" };
      await expectAllConverged(
        [{ page: deviceA, label: "device A" }],
        workspaceId,
        converged,
      );
      const before = await syncTableCounts(sql, workspaceId);
      expect(before.deltas).toBe(3);

      // Device A: stop, dispose, reload, erase, and re-sync from scratch. The
      // relay's ack row for A already sits at the head, so the client re-pulls
      // from cursor zero — the whole log is delivered again.
      await deviceA.evaluate(async () => {
        const api = window.__vultoGraphSyncDiagnostics!;
        await api.stopSync();
        await api.dispose();
      });
      await deviceA.reload();
      await deviceA.getByRole("button", { name: "Retry" }).click();
      await expect(deviceA.getByTestId("graph-sync-unlocked")).toBeVisible({
        timeout: 20_000,
      });
      await deviceA.evaluate(async (id) => {
        const api = window.__vultoGraphSyncDiagnostics!;
        await api.eraseLocalStore(id);
        await api.initialize();
      }, workspaceId);

      await syncUntilQuiet(deviceA);

      await expectAllConverged(
        [
          { page: deviceA, label: "device A (rebuilt)" },
          { page: deviceB, label: "device B" },
        ],
        workspaceId,
        converged,
      );
      const after = await syncTableCounts(sql, workspaceId);
      expect(after.deltas, "re-delivery created no new deltas").toBe(3);
      expect(after.acks, "the erased device reused its existing ack row").toBe(2);
    } finally {
      await contextA?.close();
      await contextB?.close();
      await sql.end();
    }
  });

  test("a cold third device bootstraps by plain replay from cursor zero", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    let contextC: BrowserContext | undefined;
    try {
      if (!account) throw new Error("no account");
      const workspaceId = await createWorkspace(sql, account.userId);
      contextA = await newDeviceContext(browser);
      contextB = await newDeviceContext(browser);
      const deviceA = await openDevice(contextA, workspaceId);
      const deviceB = await openDevice(contextB, workspaceId);

      await applyLocalWrites(deviceA, [["a", "1"]]);
      await applyLocalWrites(deviceB, [["b", "2"]]);
      await syncUntilQuiet(deviceA);
      await syncUntilQuiet(deviceB);
      await syncUntilQuiet(deviceA);

      // C has never seen this workspace: it replays the whole log as `update`
      // deltas (no snapshot bootstrap).
      contextC = await newDeviceContext(browser);
      const deviceC = await openDevice(contextC, workspaceId);
      await syncUntilQuiet(deviceC);

      await expectAllConverged(
        [{ page: deviceC, label: "device C (cold)" }],
        workspaceId,
        { a: "1", b: "2" },
      );
      const statusC = await syncStatus(deviceC);
      expect(statusC.highestAckedCursor).toBe(2);

      const counts = await syncTableCounts(sql, workspaceId);
      expect(counts.deltas).toBe(2);
      expect(counts.acks, "three devices, three ack rows").toBe(3);
    } finally {
      await contextA?.close();
      await contextB?.close();
      await contextC?.close();
      await sql.end();
    }
  });
});
