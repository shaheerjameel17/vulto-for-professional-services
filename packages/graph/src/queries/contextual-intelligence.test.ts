import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import { getLocalContextualIntelligence } from "./contextual-intelligence";

const EMPLOYEE = "10000000-0000-4000-8000-000000000001";
const SKILL = "10000000-0000-4000-8000-000000000002";
const ROLE = "10000000-0000-4000-8000-000000000003";
const REFERENCE = "10000000-0000-4000-8000-000000000004";

afterEach(() => vi.restoreAllMocks());

describe("the local Contextual Intelligence query", () => {
  it("resolves Tier 0 skills, open roles and references with the network cut", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const putNode = (
      nodeId: string,
      nodeType: string,
      record: Record<string, unknown>,
    ) =>
      cache.putNode({
        nodeId,
        nodeType,
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        version: 1,
        record: {
          node_id: nodeId,
          node_type: nodeType,
          lifecycle_status: "Active",
          ...record,
        },
      });
    const putEdge = (
      edgeId: string,
      edgeType: string,
      fromNodeId: string,
      toNodeId: string,
    ) =>
      cache.putEdge({
        edgeId,
        edgeType,
        fromNodeId,
        toNodeId,
        effectiveFrom: null,
        effectiveTo: null,
        isSoftDeleted: false,
        version: 1,
        record: {
          edge_id: edgeId,
          edge_type: edgeType,
          from_node_id: fromNodeId,
          to_node_id: toNodeId,
        },
      });
    await putNode(SKILL, "Skill", { name: "TypeScript" });
    await putNode(ROLE, "OpenRole", { title: "Staff Engineer" });
    await putNode(REFERENCE, "GraphReference", { excerpt: "Delivery lead" });
    await putEdge("20000000-0000-4000-8000-000000000001", "has_skill", EMPLOYEE, SKILL);
    await putEdge(
      "20000000-0000-4000-8000-000000000002",
      "requires_skill",
      ROLE,
      SKILL,
    );
    await putEdge(
      "20000000-0000-4000-8000-000000000003",
      "references",
      REFERENCE,
      EMPLOYEE,
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("offline"));

    await expect(getLocalContextualIntelligence(database, EMPLOYEE)).resolves.toEqual({
      skills: [expect.objectContaining({ name: "TypeScript" })],
      openRoles: [expect.objectContaining({ title: "Staff Engineer" })],
      references: [expect.objectContaining({ excerpt: "Delivery lead" })],
    });
    expect(fetch).not.toHaveBeenCalled();
    await database.close();
  });
});
