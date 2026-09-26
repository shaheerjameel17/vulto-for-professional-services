import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyOptimistic, type MutatorContext } from "./foundation";
import { MemoryCache } from "./memory-cache";

const now = "2026-09-26T12:00:00.000Z";
async function fixture() {
  const cache = new MemoryCache();
  const userId = randomUUID(),
    nodeId = randomUUID(),
    workspaceId = randomUUID(),
    edgeId = randomUUID();
  await cache.putNode({
    nodeId,
    nodeType: "Notification",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: {
      node_id: nodeId,
      node_type: "Notification",
      recipient_user_id: userId,
      message: "Keep me",
      read_at: null,
      dismissed_at: null,
    },
  });
  await cache.putEdge({
    edgeId,
    edgeType: "delivered_to",
    fromNodeId: nodeId,
    toNodeId: userId,
    effectiveFrom: null,
    effectiveTo: null,
    isSoftDeleted: false,
    version: 1,
    record: {},
  });
  const context: MutatorContext = {
    cache,
    userId,
    workspaceId,
    mutationId: randomUUID(),
    now,
  };
  return { cache, context, nodeId, userId, edgeId };
}
describe("optimistic Notification boundaries", () => {
  it("refuses every generic node and edge path and aligns has_skill", async () => {
    const w = await fixture();
    const before = await w.cache.getNode(w.nodeId);
    for (const [name, args] of [
      [
        "graph.createNode",
        {
          node: {
            node_id: randomUUID(),
            node_type: "Notification",
            schema_version: 1,
            lifecycle_status: "Active",
          },
        },
      ],
      [
        "graph.updateNodeFields",
        { node_id: w.nodeId, expected_version: null, patch: { message: "Changed" } },
      ],
      ["graph.softDeleteNode", { node_id: w.nodeId }],
      [
        "graph.transitionLifecycle",
        { node_id: w.nodeId, expected_version: 1, to_status: "Inactive" },
      ],
      [
        "graph.createEdge",
        {
          edge: {
            edge_id: randomUUID(),
            edge_type: "delivered_to",
            from_node_id: w.nodeId,
            to_node_id: w.userId,
          },
        },
      ],
      ["graph.closeEdge", { edge_id: w.edgeId, effective_to: now }],
      ["graph.updateEdgeMetadata", { edge_id: w.edgeId, metadata: {} }],
      [
        "graph.createEdge",
        {
          edge: {
            edge_id: randomUUID(),
            edge_type: "has_skill",
            from_node_id: randomUUID(),
            to_node_id: randomUUID(),
          },
        },
      ],
    ] as const)
      await expect(applyOptimistic(w.context, name, args)).rejects.toMatchObject({
        reason: "requires-feature-mutation",
      });
    expect(await w.cache.getNode(w.nodeId)).toEqual(before);
    expect(w.cache.nodes.size).toBe(1);
    expect(w.cache.edges.size).toBe(1);
    const skillEdge = {
      ...(await w.cache.getEdge(w.edgeId))!,
      edgeId: randomUUID(),
      edgeType: "has_skill",
    };
    await w.cache.putEdge(skillEdge);
    for (const [name, args] of [
      ["graph.closeEdge", { edge_id: skillEdge.edgeId, effective_to: now }],
      ["graph.updateEdgeMetadata", { edge_id: skillEdge.edgeId, metadata: {} }],
    ] as const)
      await expect(applyOptimistic(w.context, name, args)).rejects.toMatchObject({
        reason: "requires-feature-mutation",
      });
  });
  it("changes only read state, stays idempotent and fails closed on foreign/multiple-edge rows", async () => {
    const w = await fixture();
    expect(
      await applyOptimistic(w.context, "notification.markRead", {
        notification_id: w.nodeId,
      }),
    ).toHaveLength(1);
    const first = await w.cache.getNode(w.nodeId);
    expect(
      await applyOptimistic(w.context, "notification.markRead", {
        notification_id: w.nodeId,
      }),
    ).toEqual([]);
    expect(await w.cache.getNode(w.nodeId)).toEqual(first);
    await applyOptimistic(w.context, "notification.dismiss", {
      notification_id: w.nodeId,
    });
    expect((await w.cache.getNode(w.nodeId))!.record).toMatchObject({
      read_at: now,
      dismissed_at: now,
      message: "Keep me",
    });
    await expect(
      applyOptimistic(w.context, "notification.markRead", {
        notification_id: w.nodeId,
        message: "Bad",
      }),
    ).rejects.toThrow();
    await w.cache.putEdge({
      ...(await w.cache.getEdge(w.edgeId))!,
      edgeId: randomUUID(),
    });
    await expect(
      applyOptimistic(w.context, "notification.markRead", {
        notification_id: w.nodeId,
      }),
    ).rejects.toMatchObject({ reason: "not-found" });
    await expect(
      applyOptimistic(w.context, "notification.markRead", {
        notification_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "not-found" });
  });
});
