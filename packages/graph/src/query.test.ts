import { describe, expect, it } from "vitest";
import { graphQuerySchema } from "./query";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = "2026-08-17T10:30:00.000Z";

describe("typed graph query contract", () => {
  it("accepts an exact registered relationship and supplies bounded defaults", () => {
    expect(
      graphQuerySchema.parse({
        kind: "edge-neighbors",
        startNodeId: ID,
        direction: "outgoing",
        asOf: NOW,
        edgeType: "managed_by",
        fromNodeType: "Employee",
        toNodeType: "Employee",
      }),
    ).toMatchObject({ limit: 50, includeSoftDeleted: false });
  });

  it("rejects an invented relationship triple and unbounded recursion", () => {
    expect(() =>
      graphQuerySchema.parse({
        kind: "edge-neighbors",
        startNodeId: ID,
        direction: "outgoing",
        asOf: NOW,
        edgeType: "managed_by",
        fromNodeType: "Employee",
        toNodeType: "Project",
      }),
    ).toThrow(/Unregistered relationship/);

    expect(() =>
      graphQuerySchema.parse({
        kind: "recursive-neighbors",
        startNodeId: ID,
        direction: "outgoing",
        asOf: NOW,
        edgeType: "managed_by",
        fromNodeType: "Employee",
        toNodeType: "Employee",
        maxDepth: 9,
      }),
    ).toThrow();
  });
});
