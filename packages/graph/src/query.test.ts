import { describe, expect, it } from "vitest";
import { graphQuerySchema } from "./query";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = "2026-08-17T10:30:00.000Z";

describe("typed graph query contract", () => {
  it("accepts only registered device names with exact per-name arguments", () => {
    expect(
      graphQuerySchema.parse({
        kind: "device-query",
        name: "search.query",
        args: { text: "sql", limit: 8 },
      }),
    ).toMatchObject({ name: "search.query" });
    expect(
      graphQuerySchema.parse({
        kind: "device-query",
        name: "benchForecast.get",
        args: { window: { from_date: "2026-03-01", to_date: "2026-03-31" } },
      }),
    ).toMatchObject({ name: "benchForecast.get" });
    expect(
      graphQuerySchema.parse({
        kind: "device-query",
        name: "contextualIntelligence.get",
        args: { employee_id: ID },
      }),
    ).toMatchObject({ name: "contextualIntelligence.get" });
    expect(
      graphQuerySchema.parse({
        kind: "device-query",
        name: "conflictCheck.evaluate",
        args: {
          employeeId: ID,
          callerUserId: ID,
          startDate: "2026-03-01",
          endDate: "2026-03-31",
          billablePercentage: 50,
          nearCapacityWarningThreshold: 90,
        },
      }),
    ).toMatchObject({ name: "conflictCheck.evaluate" });
    for (const query of [
      { kind: "device-query", name: "invented" },
      { kind: "device-query", name: "notification.listForUser", args: {} },
      { kind: "device-query", name: "notification.unreadActionCount", userId: ID },
      {
        kind: "device-query",
        name: "search.query",
        args: { text: "sql", role: "owner" },
      },
      {
        kind: "device-query",
        name: "benchForecast.get",
        args: {
          window: { from_date: "2026-03-01", to_date: "2026-03-31" },
          role: "owner",
        },
      },
      {
        kind: "device-query",
        name: "contextualIntelligence.get",
        args: { employee_id: ID, includeProtected: true },
      },
      {
        kind: "device-query",
        name: "conflictCheck.evaluate",
        args: {
          employeeId: ID,
          callerUserId: ID,
          startDate: "2026-03-01",
          endDate: "2026-03-31",
          billablePercentage: 50,
          nearCapacityWarningThreshold: 90,
          role: "owner",
        },
      },
    ])
      expect(graphQuerySchema.safeParse(query).success).toBe(false);
  });
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
