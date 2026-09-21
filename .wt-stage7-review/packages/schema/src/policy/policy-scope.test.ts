import { describe, expect, it } from "vitest";
import { enumerateMatrixCells } from "./matrix-coverage";
import { resolvePermission, resolvePolicyCell } from "./policy-table";

describe("resolvePolicyCell", () => {
  it("collapses to resolvePermission for every matrix cell: scope 'any' keeps its outcome, every other scope is none (F128)", () => {
    for (const { role, nodeType, partitionKey } of enumerateMatrixCells()) {
      const cell = resolvePolicyCell(role, nodeType, partitionKey);
      const collapsed =
        cell.scope === "any"
          ? cell.restrictedLabel === undefined
            ? { outcome: cell.outcome }
            : { outcome: cell.outcome, restrictedLabel: cell.restrictedLabel }
          : { outcome: "none" };
      expect(collapsed, `${role} ${nodeType}/${partitionKey}`).toEqual(
        resolvePermission(role, nodeType, partitionKey),
      );
    }
  });

  it("preserves the row-level qualifier the ceiling hides", () => {
    expect(resolvePolicyCell("team-member", "LeaveRequest", "record")).toMatchObject({
      outcome: "full",
      scope: "own",
    });
    expect(resolvePolicyCell("manager", "Employee", "operational")).toMatchObject({
      scope: "direct-reports",
    });
  });
});
