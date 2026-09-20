import { describe, expect, it } from "vitest";
import { resolvePermissionDecision } from "./policy-table";

describe("FDN-68 PermissionDecision provenance", () => {
  it("uses POLICY_ROLES order for both the snapshot and a tied deciding role", () => {
    const permutations = [
      ["team-member", "manager", "finance-admin", "hr-admin", "owner"],
      ["owner", "hr-admin", "finance-admin", "manager", "team-member"],
      ["manager", "owner", "team-member", "hr-admin", "finance-admin"],
    ] as const;

    for (const roles of permutations) {
      expect(resolvePermissionDecision(roles, "AuditEntry", "record")).toEqual({
        outcome: "full",
        decidingRole: "owner",
        rolesSnapshot: ["owner", "hr-admin", "finance-admin", "manager", "team-member"],
      });
    }
  });

  it("deduplicates roles and leaves a denial without a deciding role", () => {
    expect(
      resolvePermissionDecision(
        ["team-member", "finance-admin", "team-member"],
        "AuditEntry",
        "record",
      ),
    ).toEqual({
      outcome: "none",
      decidingRole: null,
      rolesSnapshot: ["finance-admin", "team-member"],
    });
  });
});
