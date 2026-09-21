import { POLICY_ROLES } from "./policy-table";
import { describe, expect, it } from "vitest";
import {
  countMatrixCoverage,
  enumerateMatrixCells,
  MATRIX_COVERAGE_BASELINE,
} from "./matrix-coverage";

/**
 * FDN-55 Stage 1 — `VPS-A007` A007-T06's "coverage MUST NOT decrease" as an
 * assertion rather than a trusted property.
 */
describe("VPS-A007 A007-T06 — permission matrix coverage", () => {
  it("every enumerated matrix cell resolves to a concrete permission", () => {
    const total = enumerateMatrixCells().length;
    const covered = countMatrixCoverage();
    expect(
      covered,
      `A004-T07 / A007-T06: every (role, node type, partition) combination must resolve. ${total - covered} of ${total} did not.`,
    ).toBe(total);
  });

  it("coverage has not decreased from the committed baseline", () => {
    const covered = countMatrixCoverage();
    expect(
      covered,
      `A007-T06: matrix coverage dropped from ${MATRIX_COVERAGE_BASELINE} to ${covered}. ` +
        `A schema change removed a node type, a partition, or a role from the interceptor's reach. ` +
        `If deliberate, update MATRIX_COVERAGE_BASELINE in matrix-coverage.ts with a note on why.`,
    ).toBeGreaterThanOrEqual(MATRIX_COVERAGE_BASELINE);
  });

  it("every workspace role is present in the matrix (no role silently dropped)", () => {
    const rolesInCells = new Set(enumerateMatrixCells().map((c) => c.role));
    for (const role of POLICY_ROLES) {
      expect(
        rolesInCells.has(role),
        `A007-T06: role "${role}" appears in no matrix cell`,
      ).toBe(true);
    }
    // Manager is derived, not a stored membership role (VPS-F001 G06), but it
    // is a permission role the matrix must still cover.
    expect(rolesInCells.has("manager")).toBe(true);
  });
});
