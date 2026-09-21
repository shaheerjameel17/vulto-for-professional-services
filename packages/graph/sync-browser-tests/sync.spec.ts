import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  applyMutation,
  device,
  eq,
  graphMutations,
  member,
  revokeWorkspaceAdmission,
} from "../../../services/api/src/test/sync-browser-support.js";
import {
  NetworkSwitch,
  principalFor,
  audienceMaterializer,
  cacheName,
  createOwnedWorkspace,
  createWorkspaceAsMember,
  db,
  listEntities,
  mutate,
  newEntity,
  openHarness,
  scanBrowserStorage,
  seedEntities,
  seedProtected,
  signInNewUser,
  statusOf,
  untilSynced,
} from "./helpers.js";

const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

test("first sign-in replicates the member's rows and the query returns them", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const ids = await seedEntities(workspaceId, userId, 3);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 3);
  expect(await listEntities(page)).toEqual([...ids].sort());
});

test("cold offline boot: with the API unreachable, a reload still answers queries and reports Offline", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const ids = await seedEntities(workspaceId, userId, 2);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 2);

  network.cut();
  await page.reload();
  await page.waitForFunction(
    () => (window as unknown as { __vultoSync?: unknown }).__vultoSync !== undefined,
  );
  expect(await listEntities(page)).toEqual([...ids].sort());
  await expect(statusOf(page)).toHaveText("Offline");
});

test("three offline mutations replay on reconnect, each applied exactly once", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 0);

  network.cut();
  const created = [
    newEntity(workspaceId),
    newEntity(workspaceId),
    newEntity(workspaceId),
  ];
  const outcomes = [];
  for (const node of created)
    outcomes.push(await mutate(page, "graph.createNode", { node }));
  expect(outcomes.every((o) => o.accepted)).toBe(true);
  expect((await listEntities(page)).length).toBe(3);
  await expect(statusOf(page)).toHaveText("PendingChanges");

  network.restore();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(statusOf(page)).toHaveText("Synced", { timeout: 90_000 });
  const applied = await db
    .select()
    .from(graphMutations)
    .where(eq(graphMutations.workspaceId, workspaceId));
  expect(applied.map((row) => row.mutationId).sort()).toEqual(
    outcomes.map((o) => o.mutationId!).sort(),
  );
  expect(new Set(applied.map((r) => r.mutationId)).size).toBe(3);
  expect((await listEntities(page)).sort()).toEqual(
    created.map((n) => n.node_id).sort(),
  );
});

test("two tabs: a mutation in one appears in the other without a reload", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 0);
  const second = await context.newPage();
  await openHarness(second, workspaceId, userId);
  await untilSynced(second, 0);

  const node = newEntity(workspaceId);
  expect((await mutate(page, "graph.createNode", { node })).accepted).toBe(true);
  await expect.poll(() => listEntities(second)).toEqual([node.node_id]);
});

test("a queued state transition the server rejects as stale is reverted locally and needs attention", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const [nodeId] = await seedEntities(workspaceId, userId, 1);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 1);

  network.cut();
  const outcome = await mutate(page, "graph.transitionLifecycle", {
    node_id: nodeId,
    to_status: "Inactive",
    expected_version: 1,
  });
  expect(outcome.accepted, JSON.stringify(outcome)).toBe(true);
  // Meanwhile the server moves the row on, so the queued transition's base version is stale.
  const owner = await principalFor(userId, workspaceId);
  const moved = await applyMutation(owner, {
    mutation_id: randomUUID(),
    name: "graph.updateNodeFields",
    args: { node_id: nodeId, expected_version: 1, patch: {} },
  });
  expect(moved.status).toBe("applied");

  network.restore();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(statusOf(page)).toHaveText("NeedsAttention", { timeout: 90_000 });
  await expect(page.getByTestId("sync-attention")).toContainText("stale-state");
  const nodes = await page.evaluate(async (id) => {
    const w = window as unknown as {
      __vultoSync: {
        client: {
          query(q: unknown): Promise<{ result: { node: { lifecycleStatus: string } } }>;
        };
      };
    };
    return (
      await w.__vultoSync.client.query({
        kind: "node-get",
        nodeId: id,
        nodeType: "Entity",
      })
    ).result.node.lifecycleStatus;
  }, nodeId);
  expect(nodes).toBe("Active");
});

test("removing the member's role removes the rows they may no longer read from the cache", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const fixture = await createWorkspaceAsMember(userId, ["hr-admin"]);
  const { workspaceId } = fixture;
  await seedProtected(workspaceId, "irrelevant", "irrelevant");
  await openHarness(page, workspaceId, userId);
  await expect(statusOf(page)).toHaveText("Synced");
  const hrOnly = await page.evaluate(async () => {
    const w = window as unknown as {
      __vultoSync: {
        client: { dump(): Promise<Record<string, { node_type?: string }[]>> };
      };
    };
    return (await w.__vultoSync.client.dump())["cache_nodes"]!.length;
  });
  expect(hrOnly).toBeGreaterThan(0);

  // The same steps the role-change path takes: the role changes, then the audience is recomputed.
  await db.update(member).set({ role: "team-member" }).where(eq(member.userId, userId));
  await db.transaction((tx) =>
    audienceMaterializer.recomputeWorkspace(tx, workspaceId),
  );
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const w = window as unknown as {
          __vultoSync: { client: { dump(): Promise<Record<string, unknown[]>> } };
        };
        return (await w.__vultoSync.client.dump())["cache_nodes"]!.length;
      }),
    )
    .toBeLessThan(hrOnly);
});

test("revoking the person's access erases that workspace's local database", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const fixture = await createWorkspaceAsMember(userId, ["hr-admin"]);
  const { workspaceId } = fixture;
  await seedEntities(workspaceId, fixture.people.owner!.userId, 1).catch(() => []);
  await openHarness(page, workspaceId, userId);
  await expect(statusOf(page)).toHaveText("Synced");
  expect((await scanBrowserStorage(page)).databases).toContain(
    cacheName(workspaceId, userId),
  );

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, userId));
  await revokeWorkspaceAdmission(membership!.id, fixture.people.owner!.userId);
  await expect(statusOf(page)).toHaveText("signed-out:access-revoked", {
    timeout: 90_000,
  });
  await expect
    .poll(async () => (await scanBrowserStorage(page)).databases)
    .not.toContain(cacheName(workspaceId, userId));
});

test("no Tier 1 or Tier 2 value reaches any browser storage", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const tier1 = `SENTINEL-tier1-${randomUUID()}`;
  const tier2 = `SENTINEL-tier2-${randomUUID()}`;
  const employeeId = await seedProtected(workspaceId, tier1, tier2);
  await seedEntities(workspaceId, userId, 1);
  await openHarness(page, workspaceId, userId);
  await expect(statusOf(page)).toHaveText("Synced");

  // The value is readable in memory through the audited path...
  const read = await page.evaluate(async (id) => {
    const w = window as unknown as {
      __vultoSync: { client: { protectedRead(ids: string[]): Promise<unknown> } };
    };
    return JSON.stringify(await w.__vultoSync.client.protectedRead([id]));
  }, employeeId);
  expect(read).toContain(tier1);

  // ...and nowhere on the device.
  const { databases, haystack } = await scanBrowserStorage(page);
  expect(databases).toContain(cacheName(workspaceId, userId));
  expect(haystack).not.toContain(tier1);
  expect(haystack).not.toContain(tier2);
  const dump = JSON.stringify(
    await page.evaluate(() =>
      (
        window as unknown as { __vultoSync: { client: { dump(): Promise<unknown> } } }
      ).__vultoSync.client.dump(),
    ),
  );
  expect(dump).not.toContain(tier1);
  expect(dump).not.toContain(tier2);

  // Positive control: the scanner does find a value planted in IndexedDB.
  const planted = `PLANTED-${randomUUID()}`;
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("scanner-control", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("s");
        open.onsuccess = () => {
          const tx = open.result.transaction("s", "readwrite");
          tx.objectStore("s").put({ value }, "k");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    planted,
  );
  expect((await scanBrowserStorage(page)).haystack).toContain(planted);
});

test("without SharedWorker the dedicated-worker fallback replicates and answers queries", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { SharedWorker?: unknown }).SharedWorker;
  });
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  const ids = await seedEntities(workspaceId, userId, 2);
  await openHarness(page, workspaceId, userId);
  await expect(page.getByTestId("worker-kind")).toHaveText("dedicated");
  await untilSynced(page, 2);
  expect(await listEntities(page)).toEqual([...ids].sort());
});

test("revoking the device erases that workspace's local database", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const workspaceId = await createOwnedWorkspace(userId);
  await seedEntities(workspaceId, userId, 1);
  await openHarness(page, workspaceId, userId);
  await untilSynced(page, 1);
  expect((await scanBrowserStorage(page)).databases).toContain(
    cacheName(workspaceId, userId),
  );

  await db.update(device).set({ isRevoked: true }).where(eq(device.userId, userId));
  await expect(statusOf(page)).toHaveText("signed-out:access-revoked", {
    timeout: 90_000,
  });
  await expect
    .poll(async () => (await scanBrowserStorage(page)).databases)
    .not.toContain(cacheName(workspaceId, userId));
});

test("sign-out erases every workspace's cache on the origin, including one held open by another tab", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  const first = await createOwnedWorkspace(userId);
  const second = await createOwnedWorkspace(userId);
  await seedEntities(first, userId, 1);
  await seedEntities(second, userId, 1);
  await openHarness(page, first, userId);
  await untilSynced(page, 1);
  const other = await context.newPage();
  await openHarness(other, second, userId);
  await untilSynced(other, 1);

  const caches = async () =>
    (await scanBrowserStorage(page)).databases.filter((name) =>
      /^vulto:[^:]+:[^:]+$/.test(name),
    );
  expect(await caches()).toEqual(
    expect.arrayContaining([cacheName(first, userId), cacheName(second, userId)]),
  );

  await other.evaluate(() =>
    (
      window as unknown as { __vultoSync: { client: { signOut(): Promise<void> } } }
    ).__vultoSync.client.signOut(),
  );
  await expect.poll(caches, { timeout: 30_000 }).toEqual([]);
  // The device identity is deliberately kept: erasing it would let a revoked device re-register as a new one.
  expect((await scanBrowserStorage(page)).databases).toContain("vulto:device");
});
