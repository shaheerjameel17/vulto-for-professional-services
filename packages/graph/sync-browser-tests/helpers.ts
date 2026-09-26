import { randomUUID } from "node:crypto";
import net from "node:net";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { SYNC_SUITE_SEED_NODE_TYPE } from "./seed-type.js";
import {
  addNode,
  admitWorkspaceMember,
  applyMutation,
  audienceMaterializer,
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
  db,
  eq,
  getKeyServices,
  makeWorkspace,
  resolveMemberPrincipal,
  session,
  sql,
  user,
  writeProtected,
} from "../../../services/api/src/test/sync-browser-support.js";

export const webOrigin = "https://localhost:3130";
export const apiDirect = "https://localhost:3131";
/** What the browser talks to: a proxy the tests can cut. */
export const apiOrigin = "https://localhost:3132";
export const PASSWORD = "Correct horse battery staple sync 60!";
export const SEARCH_FIXTURE_EMPLOYEE_NAME = "Search Fixture Employee";

export { db, sql, eq };

/**
 * A TCP proxy in front of the API. "Cutting the network" destroys every open
 * connection (the long-lived replication request included) and refuses new ones,
 * which is what a real outage looks like to the page, workers and all.
 */
export class NetworkSwitch {
  #server: net.Server | null = null;
  #sockets = new Set<net.Socket>();
  #up = true;

  async start(): Promise<void> {
    this.#server = net.createServer((client) => {
      if (!this.#up) return void client.destroy();
      const upstream = net.connect(3131, "localhost");
      this.#sockets.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      const drop = () => {
        client.destroy();
        upstream.destroy();
        this.#sockets.delete(client);
        this.#sockets.delete(upstream);
      };
      client.on("error", drop).on("close", drop);
      upstream.on("error", drop).on("close", drop);
    });
    await new Promise<void>((resolve) =>
      this.#server!.listen(3132, "localhost", resolve),
    );
  }

  cut(): void {
    this.#up = false;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
  }

  restore(): void {
    this.#up = true;
  }

  async stop(): Promise<void> {
    this.cut();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
}

/** Signs a new account in through the API, so the browser context holds its session cookie. */
export async function signInNewUser(context: BrowserContext): Promise<string> {
  await db.execute(sql`delete from rate_limit`);
  const email = `sync-browser-${randomUUID()}@example.com`;
  const headers = { origin: webOrigin };
  const up = await context.request.post(`${apiDirect}/api/auth/sign-up/email`, {
    headers,
    data: { name: "Sync Browser", email, password: PASSWORD },
    ignoreHTTPSErrors: true,
  });
  expect(up.ok(), await up.text()).toBe(true);
  const signIn = await context.request.post(`${apiDirect}/api/auth/sign-in/email`, {
    headers,
    data: { email, password: PASSWORD },
    ignoreHTTPSErrors: true,
  });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return account!.id;
}

/** A workspace the signed-in user owns. */
export async function createOwnedWorkspace(userId: string): Promise<string> {
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  await createPendingWorkspaceAdmission({
    workspaceId,
    workspaceName: "Sync Browser Co",
    workspaceSlug: `sync-browser-${workspaceId}`,
    membershipId,
    userId,
    roles: ["owner"],
  });
  await confirmWorkspaceAdmission(membershipId);
  return workspaceId;
}

/** Another person's workspace, with the signed-in user admitted under `roles`. */
export async function createWorkspaceAsMember(
  userId: string,
  roles: ("owner" | "hr-admin" | "finance-admin" | "team-member")[],
) {
  const fixture = await makeWorkspace();
  await admitWorkspaceMember({
    workspaceId: fixture.workspaceId,
    membershipId: randomUUID(),
    userId,
    roles,
    actorUserId: fixture.people.owner!.userId,
  });
  return fixture;
}

export async function principalFor(userId: string, workspaceId: string) {
  const principal = await db.transaction((tx) =>
    resolveMemberPrincipal(tx, { userId, workspaceId }),
  );
  if (!principal) throw new Error("no such member");
  return principal;
}

/** Creates Client nodes through the real mutation pipeline, as `ownerId`. */
export async function seedClients(
  workspaceId: string,
  ownerId: string,
  count: number,
): Promise<string[]> {
  const owner = await principalFor(ownerId, workspaceId);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const nodeId = randomUUID();
    const result = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: {
        node: {
          node_id: nodeId,
          node_type: SYNC_SUITE_SEED_NODE_TYPE,
          schema_version: 1,
          lifecycle_status: "Active",
          workspace_id: workspaceId,
        },
      },
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    ids.push(nodeId);
  }
  return ids;
}

export { audienceMaterializer };

export const clientQuery = {
  kind: "node-list",
  nodeType: SYNC_SUITE_SEED_NODE_TYPE,
  limit: 200,
} as const;

/** Makes `workspaceId` the session's active workspace, which is the one the API's procedures act in. */
export async function activateWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await db
    .update(session)
    .set({ activeOrganizationId: workspaceId })
    .where(eq(session.userId, userId));
}

export async function openHarness(
  page: Page,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await activateWorkspace(userId, workspaceId);
  await page.goto(
    `${webOrigin}/sync-harness?workspaceId=${workspaceId}&userId=${userId}`,
  );
  await page.waitForFunction(
    () => (window as unknown as { __vultoSync?: unknown }).__vultoSync !== undefined,
    undefined,
    {
      timeout: 60_000,
    },
  );
}

export const statusOf = (page: Page) => page.getByTestId("sync-status");

export function listClients(page: Page): Promise<string[]> {
  return page.evaluate(async (query) => {
    const w = window as unknown as {
      __vultoSync: {
        client: {
          query(q: unknown): Promise<{ result: { nodes: { nodeId: string }[] } }>;
        };
      };
    };
    return (await w.__vultoSync.client.query(query)).result.nodes
      .map((n) => n.nodeId)
      .sort();
  }, clientQuery);
}

export function mutate(
  page: Page,
  name: string,
  args: unknown,
): Promise<{ accepted: boolean; mutationId?: string; reason?: string }> {
  return page.evaluate(
    async ([n, a]) => {
      const w = window as unknown as {
        __vultoSync: { client: { mutate(n: string, a: unknown): Promise<never> } };
      };
      return w.__vultoSync.client.mutate(n as string, a);
    },
    [name, args] as const,
  );
}

export const newClient = (workspaceId: string) => ({
  node_id: randomUUID(),
  node_type: SYNC_SUITE_SEED_NODE_TYPE,
  schema_version: 1,
  lifecycle_status: "Active",
  workspace_id: workspaceId,
});

/** A persistent IndexedDB database name per cache, as the client names it. */
export const cacheName = (workspaceId: string, userId: string) =>
  `vulto:${workspaceId}:${userId}`;

/** Every IndexedDB database on the page's origin, and every raw byte in them, as one searchable string. */
export function scanBrowserStorage(
  page: Page,
): Promise<{ databases: string[]; haystack: string }> {
  return page.evaluate(async () => {
    const latin1 = (buffer: ArrayBuffer) => {
      const bytes = new Uint8Array(buffer);
      let out = "";
      for (let i = 0; i < bytes.length; i += 8192)
        out += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return out;
    };
    const flatten = (value: unknown): string => {
      if (value instanceof ArrayBuffer) return latin1(value);
      if (ArrayBuffer.isView(value))
        return latin1(
          value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          ) as ArrayBuffer,
        );
      if (value instanceof Blob) return "";
      if (Array.isArray(value)) return value.map(flatten).join("|");
      if (value && typeof value === "object")
        return Object.entries(value)
          .map(([k, v]) => `${k}=${flatten(v)}`)
          .join("|");
      return String(value);
    };
    const infos = await indexedDB.databases();
    let haystack = "";
    const databases: string[] = [];
    for (const info of infos) {
      if (!info.name) continue;
      databases.push(info.name);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of Array.from(database.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = database
            .transaction(storeName)
            .objectStore(storeName)
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        haystack += `\n[${info.name}/${storeName}]${rows.map(flatten).join("\n")}`;
      }
      database.close();
    }
    for (const store of [localStorage, sessionStorage])
      haystack += `\n[web-storage]${JSON.stringify({ ...store })}`;
    haystack += `\n[cookies]${document.cookie}`;
    for (const name of await caches.keys()) haystack += `\n[cache-storage]${name}`;
    return { databases, haystack };
  });
}

/** Tier 1 (Employee compensation) and Tier 2 (Workspace billing) values, written as ciphertext. */
export async function seedProtected(
  workspaceId: string,
  tier1: string,
  tier2: string,
): Promise<string> {
  const services = getKeyServices();
  return db.transaction(async (tx) => {
    const employeeId = await addNode(tx, workspaceId, "Employee", {
      employee_type: "Employee",
      full_name: SEARCH_FIXTURE_EMPLOYEE_NAME,
      job_title: "Search Fixture Engineer",
    });
    await writeProtected(
      tx,
      services,
      { workspaceId, nodeId: employeeId, nodeType: "Employee" },
      "compensation",
      tier1,
    );
    await writeProtected(
      tx,
      services,
      { workspaceId, nodeId: workspaceId, nodeType: "Workspace" },
      "billing",
      { card: tier2 },
    );
    await audienceMaterializer.recomputeWorkspace(tx, workspaceId);
    return employeeId;
  });
}

/** Waits until the cache holds `count` Clients and the client reports `Synced`. */
export async function untilSynced(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await listClients(page)).length).toBe(count);
  await expect(statusOf(page)).toHaveText("Synced");
}
