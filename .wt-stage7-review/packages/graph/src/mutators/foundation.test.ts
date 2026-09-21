import { moveEmployeeEdgeId } from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { applyUndo, type MutatorContext } from "./index";
import { applyOptimistic, OptimisticRejection } from "./foundation";
import { MemoryCache } from "./memory-cache";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-09-21T09:00:00.000Z";
let counter = 0;
const uuid = () =>
  `${(++counter).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

const context = (cache: MemoryCache, mutationId = uuid()): MutatorContext => ({
  cache,
  workspaceId: WORKSPACE,
  userId: USER,
  mutationId,
  now: NOW,
});

const entity = (nodeId = uuid()) => ({
  node_id: nodeId,
  node_type: "Entity",
  schema_version: 1,
  lifecycle_status: "Active",
});

const seedEmployee = async (cache: MemoryCache) => {
  const id = uuid();
  await cache.putNode({
    nodeId: id,
    nodeType: "Employee",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: { node_id: id, node_type: "Employee", lifecycle_status: "Active" },
  });
  return id;
};

const rejects = async (work: Promise<unknown>, reason: string) => {
  await expect(work).rejects.toMatchObject({ name: "OptimisticRejection", reason });
};

describe("the optimistic foundation mutators", () => {
  it("createNode stamps provenance like the server and is undone by its before-image", async () => {
    const cache = new MemoryCache();
    const node = entity();
    const undo = await applyOptimistic(context(cache), "graph.createNode", { node });
    const stored = cache.nodes.get(node.node_id)!;
    expect(stored.version).toBe(1);
    expect(stored.record).toMatchObject({
      workspace_id: WORKSPACE,
      created_by: USER,
      created_at: NOW,
      is_soft_deleted: false,
    });
    await applyUndo(cache, undo);
    expect(cache.nodes.size).toBe(0);
  });

  it("createNode refuses a split, protected or unregistered type, and a duplicate id", async () => {
    const cache = new MemoryCache();
    for (const type of ["Employee", "PayRun", "HRCase"]) {
      await rejects(
        applyOptimistic(context(cache), "graph.createNode", {
          node: { ...entity(), node_type: type },
        }),
        "requires-feature-mutation",
      );
    }
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", {
        node: { ...entity(), node_type: "Nope" },
      }),
      "invalid-args",
    );
    const node = entity();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", { node }),
      "invalid-args",
    );
  });

  it("updateNodeFields merges, bumps the version, checks the base version, and reverts", async () => {
    const cache = new MemoryCache();
    const node = entity();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    const undo = await applyOptimistic(context(cache), "graph.updateNodeFields", {
      node_id: node.node_id,
      expected_version: 1,
      patch: { display_name: "A" },
    });
    expect(cache.nodes.get(node.node_id)).toMatchObject({
      version: 2,
      record: { display_name: "A" },
    });
    await rejects(
      applyOptimistic(context(cache), "graph.updateNodeFields", {
        node_id: node.node_id,
        expected_version: 1,
        patch: { display_name: "B" },
      }),
      "stale-state",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(node.node_id)).toMatchObject({ version: 1 });
    expect(cache.nodes.get(node.node_id)!.record).not.toHaveProperty("display_name");
  });

  it("updateNodeFields refuses a split type, as the server does", async () => {
    const cache = new MemoryCache();
    const employee = await seedEmployee(cache);
    await rejects(
      applyOptimistic(context(cache), "graph.updateNodeFields", {
        node_id: employee,
        expected_version: null,
        patch: { display_name: "x" },
      }),
      "requires-feature-mutation",
    );
  });

  it("softDeleteNode marks the row and refuses a second delete", async () => {
    const cache = new MemoryCache();
    const node = entity();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    const undo = await applyOptimistic(context(cache), "graph.softDeleteNode", {
      node_id: node.node_id,
    });
    expect(cache.nodes.get(node.node_id)).toMatchObject({
      isSoftDeleted: true,
      version: 2,
      record: { soft_deleted_by: USER, soft_deleted_at: NOW },
    });
    await rejects(
      applyOptimistic(context(cache), "graph.softDeleteNode", {
        node_id: node.node_id,
      }),
      "target-deleted",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(node.node_id)!.isSoftDeleted).toBe(false);
  });

  it("transitionLifecycle carries the base version: a stale one is refused locally", async () => {
    const cache = new MemoryCache();
    const employee = await seedEmployee(cache);
    const undo = await applyOptimistic(context(cache), "graph.transitionLifecycle", {
      node_id: employee,
      to_status: "Inactive",
      expected_version: 1,
    });
    expect(cache.nodes.get(employee)).toMatchObject({
      lifecycleStatus: "Inactive",
      version: 2,
    });
    await rejects(
      applyOptimistic(context(cache), "graph.transitionLifecycle", {
        node_id: employee,
        to_status: "Converted",
        expected_version: 1,
      }),
      "stale-state",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(employee)).toMatchObject({
      lifecycleStatus: "Active",
      version: 1,
    });
  });

  it("createEdge and closeEdge apply, bump the version and revert", async () => {
    const cache = new MemoryCache();
    const a = await seedEmployee(cache);
    const b = await seedEmployee(cache);
    const edgeId = uuid();
    const edge = {
      edge_id: edgeId,
      edge_type: "managed_by",
      from_node_id: a,
      to_node_id: b,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    };
    const created = await applyOptimistic(context(cache), "graph.createEdge", { edge });
    expect(cache.edges.get(edgeId)).toMatchObject({ version: 1, effectiveTo: null });
    const closed = await applyOptimistic(context(cache), "graph.closeEdge", {
      edge_id: edgeId,
      effective_to: "2026-02-01T00:00:00.000Z",
    });
    expect(cache.edges.get(edgeId)).toMatchObject({
      version: 2,
      effectiveTo: "2026-02-01T00:00:00.000Z",
    });
    await rejects(
      applyOptimistic(context(cache), "graph.closeEdge", {
        edge_id: edgeId,
        effective_to: "2026-03-01T00:00:00.000Z",
      }),
      "invalid-args",
    );
    await applyUndo(cache, [...created, ...closed]);
    expect(cache.edges.size).toBe(0);
  });

  it("moveEmployee closes and opens at one instant, rejects loops, and reverts", async () => {
    const cache = new MemoryCache();
    const [a, b, c] = [
      await seedEmployee(cache),
      await seedEmployee(cache),
      await seedEmployee(cache),
    ];
    const move = (
      employee: string,
      manager: string | null,
      from: string,
      id = uuid(),
    ) =>
      applyOptimistic(context(cache, id), "org.moveEmployee", {
        employee_id: employee,
        new_manager_id: manager,
        effective_from: from,
      });
    await move(a, b, "2026-01-01T00:00:00.000Z");
    await rejects(move(b, a, "2026-02-01T00:00:00.000Z"), "cycle");
    await move(b, c, "2026-02-01T00:00:00.000Z");
    await rejects(move(c, a, "2026-03-01T00:00:00.000Z"), "cycle");
    await rejects(move(a, a, "2026-03-01T00:00:00.000Z"), "cycle");
    await rejects(move(a, b, "2026-04-01T00:00:00.000Z"), "no-change");

    const id = uuid();
    const undo = await move(a, c, "2026-06-01T00:00:00.000Z", id);
    const edges = (await cache.edgesFrom(a, "managed_by")).sort((x, y) =>
      String(x.effectiveFrom).localeCompare(String(y.effectiveFrom)),
    );
    expect(edges.map((e) => [e.effectiveFrom, e.effectiveTo])).toEqual([
      ["2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"],
      ["2026-06-01T00:00:00.000Z", null],
    ]);
    // The opened edge has the id the server derives from the same mutation.
    expect(edges[1]!.edgeId).toBe(moveEmployeeEdgeId(id));
    await applyUndo(cache, undo);
    const after = await cache.edgesFrom(a, "managed_by");
    expect(after).toHaveLength(1);
    expect(after[0]!.effectiveTo).toBeNull();
  });

  it("refuses unknown mutations and malformed arguments", async () => {
    const cache = new MemoryCache();
    await rejects(
      applyOptimistic(context(cache), "nope.nothing", {}),
      "unknown-mutation",
    );
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", { extra: 1 }),
      "invalid-args",
    );
    expect(new OptimisticRejection("x").name).toBe("OptimisticRejection");
  });
});
