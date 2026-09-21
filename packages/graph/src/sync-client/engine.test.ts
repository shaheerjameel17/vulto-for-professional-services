import { MUTATIONS, defineMutation } from "@vulto/schema";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  apiHeaders,
  createApiClient,
  type ApiClient,
  type MutationEnvelope,
  type MutationOutcome,
} from "./api";
import type { ShapeChange, ShapeTemplateName } from "./cache";
import { SyncEngine, type EngineOptions } from "./engine";
import { backoffDelayMs } from "./outbox";
import type { ProtectedItem } from "./protected-store";
import type { ShapeEvent, ShapeFailure, ShapeSource } from "./shape-source";
import { openTestDatabase } from "./test-database";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SENTINEL = "SENTINEL-protected-value-77";
let counter = 0;
const uuid = () =>
  `${(++counter).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

class FakeSource implements ShapeSource {
  handlers: Parameters<ShapeSource["start"]>[0] | null = null;
  stopped = false;
  constructor(
    readonly template: ShapeTemplateName,
    readonly resume: { handle: string | null; offset: string | null },
  ) {}
  start(handlers: Parameters<ShapeSource["start"]>[0]) {
    this.handlers = handlers;
  }
  stop() {
    this.stopped = true;
  }
  emit(events: ShapeEvent[]) {
    return this.handlers!.onEvents(events);
  }
  fail(failure: ShapeFailure) {
    this.handlers!.onFailure(failure);
  }
}

/** A server that applies each mutation id once, like the real pipeline. */
class FakeApi implements ApiClient {
  applied = new Map<string, MutationOutcome>();
  calls: MutationEnvelope[][] = [];
  offline = false;
  reject = new Map<string, string>();
  protectedItems: ProtectedItem[] = [];
  async applyMutations(mutations: readonly MutationEnvelope[]) {
    this.calls.push([...mutations]);
    if (this.offline) throw new ApiError("network", "down");
    const out: MutationOutcome[] = [];
    let blocked = false;
    for (const m of mutations) {
      if (blocked) {
        out.push({
          mutation_id: m.mutation_id,
          status: "rejected",
          reason: "blocked-by-earlier-rejection",
        });
        continue;
      }
      const seen = this.applied.get(m.mutation_id);
      if (seen) {
        out.push({ ...seen, status: "duplicate" });
      } else if (this.reject.has(m.mutation_id)) {
        out.push({
          mutation_id: m.mutation_id,
          status: "rejected",
          reason: this.reject.get(m.mutation_id)!,
        });
        blocked = true;
      } else {
        const outcome: MutationOutcome = {
          mutation_id: m.mutation_id,
          status: "applied",
        };
        this.applied.set(m.mutation_id, outcome);
        out.push(outcome);
      }
    }
    return out;
  }
  async protectedRead() {
    if (this.offline) throw new ApiError("network", "down");
    return this.protectedItems;
  }
  async registerDevice() {}
}

async function harness(overrides: Partial<EngineOptions> = {}) {
  const database = await openTestDatabase();
  const api = new FakeApi();
  const sources: FakeSource[] = [];
  const timers: { work: () => void; ms: number; cancelled: boolean }[] = [];
  const erased: string[] = [];
  const engine = new SyncEngine({
    workspaceId: WORKSPACE,
    userId: USER,
    database,
    api,
    createShapeSource: (template, resume) => {
      const source = new FakeSource(template, resume);
      sources.push(source);
      return source;
    },
    eraseLocalData: async () => {
      erased.push("erased");
    },
    newId: uuid,
    now: () => "2026-09-21T09:00:00.000Z",
    setTimer: (work, ms) => {
      const timer = { work, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    ...overrides,
  });
  await engine.start();
  const source = (template: ShapeTemplateName) =>
    sources.filter((s) => s.template === template).at(-1)!;
  // Reads go through the engine so they never race its background work.
  const guarded = {
    all: (sql: string, params?: readonly (string | number | null)[]) =>
      engine.withDatabase((d) => d.all(sql, params)),
  };
  return { engine, api, database: guarded, sources, source, timers, erased };
}

const nodeRow = (nodeId: string, over: Record<string, unknown> = {}): ShapeChange => ({
  operation: "insert",
  value: {
    node_id: nodeId,
    workspace_id: WORKSPACE,
    node_type: "Entity",
    lifecycle_status: "Active",
    version: 1n,
    is_soft_deleted: false,
    record: { node_id: nodeId, node_type: "Entity", lifecycle_status: "Active" },
    ...over,
  },
});

const upToDate = (offset = "1_0"): ShapeEvent => ({
  type: "up-to-date",
  cursor: { handle: "h1", offset },
});

const entityNode = (nodeId = uuid()) => ({
  node_id: nodeId,
  node_type: "Entity",
  schema_version: 1,
  lifecycle_status: "Active",
});

describe("replication into the cache", () => {
  it("applies inserts, partial updates and deletes, and stores the cursor with them", async () => {
    const h = await harness();
    const id = uuid();
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(id)],
        cursor: { handle: "h1", offset: "1_0" },
      },
      upToDate("1_0"),
    ]);
    let outcome = await h.engine.query({
      kind: "node-get",
      nodeId: id,
      nodeType: "Entity",
    });
    expect(outcome.result).toMatchObject({
      kind: "node-get",
      node: { nodeId: id, version: 1 },
    });

    // An update carries only the columns that changed.
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [
          {
            operation: "update",
            value: {
              node_id: id,
              lifecycle_status: "Inactive",
              version: 2n,
              record: {
                node_id: id,
                node_type: "Entity",
                lifecycle_status: "Inactive",
              },
            },
          },
        ],
        cursor: { handle: "h1", offset: "2_0" },
      },
    ]);
    outcome = await h.engine.query({
      kind: "node-get",
      nodeId: id,
      nodeType: "Entity",
    });
    expect(outcome.result).toMatchObject({
      node: { lifecycleStatus: "Inactive", version: 2, nodeType: "Entity" },
    });

    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [{ operation: "delete", value: { node_id: id } }],
        cursor: { handle: "h1", offset: "3_0" },
      },
    ]);
    outcome = await h.engine.query({
      kind: "node-get",
      nodeId: id,
      nodeType: "Entity",
    });
    expect(outcome.result).toEqual({ kind: "node-get", node: null });

    const [cursor] = await h.database.all(
      `SELECT handle, "offset" AS o FROM sync_cursor WHERE template = 'nodes'`,
    );
    expect(cursor).toEqual({ handle: "h1", o: "3_0" });
  });

  it("resumes from the stored cursor after a restart", async () => {
    const database = await openTestDatabase();
    const first = await harness({ database });
    await first.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(uuid())],
        cursor: { handle: "hh", offset: "9_9" },
      },
      { type: "up-to-date", cursor: { handle: "hh", offset: "9_9" } },
    ]);
    await first.engine.stop();
    const second = await harness({ database });
    expect(second.source("nodes").resume).toEqual({ handle: "hh", offset: "9_9" });
  });

  it("drops what a shape delivered and starts over on must-refetch", async () => {
    const h = await harness();
    const id = uuid();
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(id)],
        cursor: { handle: "h1", offset: "1_0" },
      },
      upToDate(),
    ]);
    await h.source("nodes").emit([{ type: "must-refetch" }]);
    expect(
      (await h.engine.query({ kind: "node-get", nodeId: id, nodeType: "Entity" }))
        .result,
    ).toEqual({ kind: "node-get", node: null });
    const cursors = await h.database.all(
      "SELECT * FROM sync_cursor WHERE template = 'nodes'",
    );
    expect(cursors).toEqual([]);
  });

  it("reports mid-sync until both shapes have caught up, then ready", async () => {
    const h = await harness();
    const q = { kind: "node-list", nodeType: "Entity" };
    expect((await h.engine.query(q)).availability).toBe("mid-sync");
    await h.source("nodes").emit([upToDate()]);
    expect((await h.engine.query(q)).availability).toBe("mid-sync");
    await h.source("edges").emit([upToDate()]);
    expect((await h.engine.query(q)).availability).toBe("ready");
  });
});

describe("the query layer over the cache", () => {
  it("lists with paging, and walks edges as of a date, including a recursive walk that survives a cycle", async () => {
    const h = await harness();
    const ids = [uuid(), uuid(), uuid(), uuid()];
    const employee = (id: string): ShapeChange =>
      nodeRow(id, {
        node_type: "Employee",
        record: { node_id: id, node_type: "Employee", lifecycle_status: "Active" },
      });
    const edge = (
      id: string,
      from: string,
      to: string,
      effectiveFrom: string | null,
      effectiveTo: string | null,
    ): ShapeChange => ({
      operation: "insert",
      value: {
        edge_id: id,
        edge_type: "managed_by",
        from_node_id: from,
        to_node_id: to,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        version: 1n,
        is_soft_deleted: false,
        record: {},
      },
    });
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: ids.map(employee),
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    await h.source("edges").emit([
      {
        type: "changes",
        changes: [
          edge(
            uuid(),
            ids[0]!,
            ids[1]!,
            "2026-01-01T00:00:00.000Z",
            "2026-06-01T00:00:00.000Z",
          ),
          edge(uuid(), ids[0]!, ids[2]!, "2026-06-01T00:00:00.000Z", null),
          edge(uuid(), ids[2]!, ids[3]!, null, null),
          edge(uuid(), ids[3]!, ids[0]!, null, null), // a loop back to the start
        ],
        cursor: { handle: "h", offset: "1" },
      },
    ]);

    const page1 = await h.engine.query({
      kind: "node-list",
      nodeType: "Employee",
      limit: 3,
    });
    expect(page1.result).toMatchObject({
      kind: "node-list",
      nextNodeId: expect.any(String),
    });
    const nodes = (page1.result as unknown as { nodes: { nodeId: string }[] }).nodes;
    const page2 = await h.engine.query({
      kind: "node-list",
      nodeType: "Employee",
      limit: 3,
      afterNodeId: nodes.at(-1)!.nodeId,
    });
    expect((page2.result as unknown as { nodes: unknown[] }).nodes).toHaveLength(1);

    const asOf = (date: string) =>
      h.engine.query({
        kind: "edge-neighbors",
        startNodeId: ids[0]!,
        direction: "outgoing",
        asOf: date,
        edgeType: "managed_by",
        fromNodeType: "Employee",
        toNodeType: "Employee",
      });
    const before = (await asOf("2026-03-01T00:00:00.000Z")).result as unknown as {
      neighbors: { node: { nodeId: string } }[];
    };
    expect(before.neighbors.map((n) => n.node.nodeId)).toEqual([ids[1]]);
    const boundary = (await asOf("2026-06-01T00:00:00.000Z")).result as unknown as {
      neighbors: { node: { nodeId: string } }[];
    };
    expect(boundary.neighbors.map((n) => n.node.nodeId)).toEqual([ids[2]]);

    const walk = await h.engine.query({
      kind: "recursive-neighbors",
      startNodeId: ids[0]!,
      direction: "outgoing",
      asOf: "2026-09-01T00:00:00.000Z",
      maxDepth: 8,
      edgeType: "managed_by",
      fromNodeType: "Employee",
      toNodeType: "Employee",
    });
    const reached = (
      walk.result as unknown as {
        neighbors: { node: { nodeId: string }; depth: number }[];
      }
    ).neighbors;
    expect(reached.map((n) => [n.node.nodeId, n.depth])).toEqual([
      [ids[2], 1],
      [ids[3], 2],
    ]);
  });

  it("tells a subscriber when the result changes, and not when it does not", async () => {
    const h = await harness();
    const seen: number[] = [];
    h.engine.subscribe({ kind: "node-list", nodeType: "Entity" }, (o) => {
      seen.push((o.result as unknown as { nodes: unknown[] }).nodes.length);
    });
    await new Promise((r) => setTimeout(r, 20));
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(uuid())],
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    await h.source("nodes").emit([upToDate()]);
    expect(seen).toEqual([0, 1]);
  });
});

describe("the outbox and optimistic writes", () => {
  it("applies a mutation optimistically, queues it, uploads it once, and removes it on applied", async () => {
    const h = await harness();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    const node = entityNode();
    const outcome = await h.engine.mutate("graph.createNode", { node });
    expect(outcome).toMatchObject({ accepted: true });
    await h.engine.drain();
    expect(
      h.api.calls.flat().filter((m) => m.name === "graph.createNode"),
    ).toHaveLength(1);
    const [row] = await h.database.all("SELECT COUNT(*) AS n FROM outbox");
    expect(row!["n"]).toBe(0);
    expect(h.engine.getState().status).toBe("Synced");
    expect(
      (
        await h.engine.query({
          kind: "node-get",
          nodeId: node.node_id,
          nodeType: "Entity",
        })
      ).result,
    ).toMatchObject({
      node: { nodeId: node.node_id },
    });
  });

  it("queues offline as PendingChanges, retries with 1 s doubling to 60 s, and uploads each exactly once on reconnect", async () => {
    const h = await harness();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    h.api.offline = true;
    const nodes = [entityNode(), entityNode(), entityNode()];
    for (const node of nodes) await h.engine.mutate("graph.createNode", { node });
    await h.engine.drain();
    expect(h.engine.getState().status).toBe("PendingChanges");
    const ladder = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(backoffDelayMs));
    const retries = h.timers.map((t) => t.ms);
    expect(retries[0]).toBe(1000);
    expect(retries.every((ms) => ladder.has(ms))).toBe(true);
    await h.engine.drain();
    await h.engine.drain();
    expect([
      backoffDelayMs(1),
      backoffDelayMs(2),
      backoffDelayMs(3),
      backoffDelayMs(7),
      backoffDelayMs(20),
    ]).toEqual([1000, 2000, 4000, 60_000, 60_000]);

    // Reconnect: everything is uploaded, in order, once each.
    h.api.offline = false;
    h.engine.notifyOnline();
    await h.engine.drain();
    const uploaded = [...h.api.applied.keys()];
    expect(uploaded).toHaveLength(3);
    const ids = h.api.calls.flat().map((m) => m.mutation_id);
    expect(new Set(ids).size).toBe(3);
    expect(h.engine.getState().status).toBe("Synced");
  });

  it("a replayed upload is a duplicate and still leaves the outbox", async () => {
    const h = await harness();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    const first = await h.engine.mutate("graph.createNode", { node: entityNode() });
    expect(first.accepted).toBe(true);
    // The server already has it (an earlier upload whose reply was lost).
    h.api.applied.set((first as { mutationId: string }).mutationId, {
      mutation_id: (first as { mutationId: string }).mutationId,
      status: "applied",
    });
    await h.engine.drain();
    const [row] = await h.database.all("SELECT COUNT(*) AS n FROM outbox");
    expect(row!["n"]).toBe(0);
  });

  it("reverts a rejected mutation locally, keeps it with its reason, and shows NeedsAttention", async () => {
    const h = await harness();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    const id = uuid();
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [
          nodeRow(id, {
            node_type: "Employee",
            record: {
              node_id: id,
              node_type: "Employee",
              lifecycle_status: "Active",
            },
          }),
        ],
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    h.api.offline = true; // hold the upload until the rejection is arranged
    const outcome = await h.engine.mutate("graph.transitionLifecycle", {
      node_id: id,
      to_status: "Inactive",
      expected_version: 1,
    });
    expect(outcome.accepted).toBe(true);
    expect(
      (await h.engine.query({ kind: "node-get", nodeId: id, nodeType: "Employee" }))
        .result,
    ).toMatchObject({
      node: { lifecycleStatus: "Inactive", version: 2 },
    });
    h.api.reject.set((outcome as { mutationId: string }).mutationId, "stale-state");
    h.api.offline = false;
    await h.engine.drain();
    expect(
      (await h.engine.query({ kind: "node-get", nodeId: id, nodeType: "Employee" }))
        .result,
    ).toMatchObject({
      node: { lifecycleStatus: "Active", version: 1 },
    });
    const state = h.engine.getState();
    expect(state.status).toBe("NeedsAttention");
    expect(state.attention).toEqual([
      {
        mutationId: (outcome as { mutationId: string }).mutationId,
        name: "graph.transitionLifecycle",
        reason: "stale-state",
      },
    ]);
    // Never silently dropped: it is still in the outbox until the person clears it.
    const [row] = await h.database.all(
      "SELECT COUNT(*) AS n FROM outbox WHERE status = 'rejected'",
    );
    expect(row!["n"]).toBe(1);
    await h.engine.dismissRejected((outcome as { mutationId: string }).mutationId);
    expect(h.engine.getState().status).not.toBe("NeedsAttention");
  });

  it("requeues the mutations blocked behind a rejection instead of rejecting them", async () => {
    const h = await harness();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    h.api.offline = true; // hold the uploads until the rejection is arranged
    const a = (await h.engine.mutate("graph.createNode", { node: entityNode() })) as {
      mutationId: string;
    };
    await h.engine.mutate("graph.createNode", { node: entityNode() });
    h.api.reject.set(a.mutationId, "role");
    h.api.offline = false;
    await h.engine.drain();
    const rows = await h.database.all(
      "SELECT mutation_id, status FROM outbox ORDER BY seq",
    );
    expect(rows.map((r) => r["status"])).toEqual(["rejected"]);
    // The second was retried after the first was set aside, and applied.
    expect(h.api.applied.size).toBe(1);
  });

  it("refuses an online-only mutation immediately while offline", async () => {
    const h = await harness();
    (MUTATIONS as Record<string, unknown>)["test.onlineOnly"] = defineMutation({
      name: "test.onlineOnly",
      input: z.object({}),
      tier: 1,
      onlineOnly: false,
      stateTransition: false,
    });
    h.source("nodes").fail({ kind: "network" });
    await new Promise((r) => setTimeout(r, 10));
    expect(await h.engine.mutate("test.onlineOnly", {})).toEqual({
      accepted: false,
      reason: "requires-connection",
    });
    delete (MUTATIONS as Record<string, unknown>)["test.onlineOnly"];
  });

  it("refuses what the optimistic layer refuses, without queuing it", async () => {
    const h = await harness();
    expect(
      await h.engine.mutate("graph.createNode", {
        node: { ...entityNode(), node_type: "Employee" },
      }),
    ).toEqual({
      accepted: false,
      reason: "requires-feature-mutation",
    });
    expect(await h.engine.mutate("nope.nothing", {})).toEqual({
      accepted: false,
      reason: "unknown-mutation",
    });
    const [row] = await h.database.all("SELECT COUNT(*) AS n FROM outbox");
    expect(row!["n"]).toBe(0);
  });
});

describe("SyncStatus", () => {
  it("is Offline with nothing queued when the network is down, and Synced once caught up", async () => {
    const h = await harness();
    h.source("nodes").fail({ kind: "network" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.engine.getState().status).toBe("Offline");
    h.engine.notifyOnline();
    await h.source("nodes").emit([upToDate()]);
    await h.source("edges").emit([upToDate()]);
    expect(h.engine.getState().status).toBe("Synced");
  });
});

describe("A003-T56 — protected values live in memory only", () => {
  const item: ProtectedItem = {
    node_id: "n1",
    partition: "compensation",
    state: "available",
    value: { salary: SENTINEL },
  };

  it("keeps a protected value out of every cache table and clears it on role change, removal and sign-out", async () => {
    const h = await harness();
    h.api.protectedItems = [item];
    const read = await h.engine.protectedRead(["n1"]);
    expect(read).toEqual({ availability: "ready", items: [item] });
    expect(h.engine.protectedStoreSize).toBe(1);

    const tables = await h.database.all(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    for (const { name } of tables) {
      const rows = await h.database.all(`SELECT * FROM "${String(name)}"`);
      expect(JSON.stringify(rows), String(name)).not.toContain(SENTINEL);
    }

    h.engine.noteRoleChange();
    expect(h.engine.protectedStoreSize).toBe(0);
    await h.engine.protectedRead(["n1"]);
    // A row leaving the person's audience narrows what they may hold.
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [{ operation: "delete", value: { node_id: uuid() } }],
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    expect(h.engine.protectedStoreSize).toBe(0);
    await h.engine.protectedRead(["n1"]);
    await h.engine.signOut();
    expect(h.engine.protectedStoreSize).toBe(0);
  });

  it("returns requires-connection with only what memory already holds while offline, and permission-absence for an empty answer", async () => {
    const h = await harness();
    h.api.protectedItems = [item];
    await h.engine.protectedRead(["n1"]);
    h.api.offline = true;
    expect(await h.engine.protectedRead(["n1"])).toEqual({
      availability: "requires-connection",
      items: [item],
    });
    expect(await h.engine.protectedRead(["other"])).toEqual({
      availability: "requires-connection",
      items: [],
    });
    h.api.offline = false;
    h.api.protectedItems = [];
    expect((await h.engine.protectedRead(["n2"])).availability).toBe(
      "permission-absence",
    );
  });
});

describe("A003-T67 — revocation and sign-out erase the cache", () => {
  it("wipes the local database before anything else runs, and stops applying rows", async () => {
    const order: string[] = [];
    const h = await harness({
      eraseLocalData: async () => {
        order.push("erase");
      },
    });
    const id = uuid();
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(id)],
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    h.api.protectedItems = [
      { node_id: id, partition: "p", state: "available", value: SENTINEL },
    ];
    await h.engine.protectedRead([id]);
    h.source("nodes").fail({ kind: "access-revoked" });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["erase"]);
    expect(h.engine.getState()).toMatchObject({
      signedOut: true,
      reason: "access-revoked",
      status: "Offline",
    });
    expect(h.engine.protectedStoreSize).toBe(0);
    // Nothing more is applied or uploaded after the wipe.
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(uuid())],
        cursor: { handle: "h", offset: "2" },
      },
    ]);
    expect(h.api.calls).toHaveLength(0);
    expect(h.sources.every((s) => s.stopped)).toBe(true);
  });

  it("signOut erases the database and reports signed-out", async () => {
    const h = await harness();
    await h.engine.signOut();
    expect(h.erased).toEqual(["erased"]);
    expect(h.engine.getState()).toMatchObject({
      signedOut: true,
      reason: "signed-out",
    });
  });

  it("an unauthenticated response leaves the cache readable and does not erase", async () => {
    const h = await harness();
    const id = uuid();
    await h.source("nodes").emit([
      {
        type: "changes",
        changes: [nodeRow(id)],
        cursor: { handle: "h", offset: "1" },
      },
    ]);
    h.source("nodes").fail({ kind: "unauthenticated" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.erased).toEqual([]);
    expect(
      (await h.engine.query({ kind: "node-get", nodeId: id, nodeType: "Entity" }))
        .result,
    ).toMatchObject({ node: { nodeId: id } });
  });
});

describe("the schema-version header (A003-T71)", () => {
  it("is sent on every API request the client makes", async () => {
    const seen: Record<string, string>[] = [];
    const fetchStub = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ result: { data: [] } }), { status: 200 });
    }) as typeof fetch;
    const api = createApiClient({ apiOrigin: "https://api.test", fetch: fetchStub });
    await api.applyMutations([]);
    await api.protectedRead([]);
    await api.registerDevice("device-1234567890abcdef", "Test");
    expect(seen).toHaveLength(3);
    for (const headers of seen)
      expect(headers["x-vulto-schema-version"]).toBe(
        apiHeaders()["x-vulto-schema-version"],
      );
    expect(Number(apiHeaders()["x-vulto-schema-version"])).toBeGreaterThanOrEqual(1);
  });

  it("classifies client-outdated and network failures", async () => {
    const outdated = createApiClient({
      apiOrigin: "https://api.test",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "client-outdated" } }), {
          status: 412,
        })) as typeof fetch,
    });
    await expect(outdated.applyMutations([])).rejects.toMatchObject({
      kind: "client-outdated",
    });
    const down = createApiClient({
      apiOrigin: "https://api.test",
      fetch: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });
    await expect(down.applyMutations([])).rejects.toMatchObject({ kind: "network" });
  });
});
