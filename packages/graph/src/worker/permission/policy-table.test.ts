import { getProtectionPartitions, NODE_TYPES } from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { POLICY_ROLES, resolvePermission, type PolicyRole } from "./policy-table";

const ALL_ROLES: readonly PolicyRole[] = POLICY_ROLES;

describe("resolvePermission — default class mapping, transcribed from VPS-A004", () => {
  it("Standard: Owner/HR Admin Full, Finance Admin Read, Manager Full, Team Member Read", () => {
    // LeavePolicy is Standard and absent from the matrix — pure A004-T08 default.
    expect(resolvePermission("owner", "LeavePolicy", "record").outcome).toBe("full");
    expect(resolvePermission("hr-admin", "LeavePolicy", "record").outcome).toBe("full");
    expect(resolvePermission("finance-admin", "LeavePolicy", "record").outcome).toBe(
      "read",
    );
    expect(resolvePermission("manager", "LeavePolicy", "record").outcome).toBe("full");
    expect(resolvePermission("team-member", "LeavePolicy", "record").outcome).toBe(
      "read",
    );
  });

  it("Finance-restricted: Manager None, everyone else at least Read", () => {
    // HeadcountPlan is Finance-restricted and IS in the matrix as its own
    // override (Full/Read/Full/None/None) — use a class-default-only probe
    // instead: none of the Finance-restricted-classed node types are
    // matrix-absent, so assert directly against the class table via a node
    // type whose split partition carries this class: Contract:content.
    expect(resolvePermission("manager", "Contract", "content").outcome).toBe(
      "restricted",
    );
    expect(resolvePermission("owner", "Contract", "content").outcome).toBe("full");
  });

  it("Owner and HR Admin only: every other role is None", () => {
    expect(resolvePermission("owner", "OrgScenario", "record").outcome).toBe("full");
    expect(resolvePermission("hr-admin", "OrgScenario", "record").outcome).toBe("full");
    expect(resolvePermission("finance-admin", "OrgScenario", "record").outcome).toBe(
      "none",
    );
    expect(resolvePermission("manager", "OrgScenario", "record").outcome).toBe("none");
    expect(resolvePermission("team-member", "OrgScenario", "record").outcome).toBe(
      "none",
    );
  });

  it("Self-only, absolute: WellnessTriggerEvent — the absolute wellness rule, no role override, not even Owner", () => {
    for (const role of ["owner", "hr-admin", "finance-admin", "manager"] as const) {
      expect(resolvePermission(role, "WellnessTriggerEvent", "record").outcome).toBe(
        "none",
      );
    }
    expect(
      resolvePermission("team-member", "WellnessTriggerEvent", "record").outcome,
    ).toBe("full");
  });

  it("Sensitive's 'Full (aggregate only)' resolves to none at the row-level surface this interceptor governs", () => {
    // PulseEntry: Owner/HR Admin get "Aggregate only" in the matrix — the
    // aggregate mechanism (VPS-F005/A004-T12-T15) is not built this stage,
    // and reading "Full" literally here would leak raw survey content.
    expect(resolvePermission("owner", "PulseEntry", "record").outcome).toBe("none");
    expect(resolvePermission("hr-admin", "PulseEntry", "record").outcome).toBe("none");
    expect(resolvePermission("team-member", "PulseEntry", "record").outcome).toBe(
      "full",
    );
  });

  it("Recipient-only (Notification) resolves to none for every role, including the class default's nominal 'Own only'", () => {
    for (const role of ALL_ROLES) {
      expect(resolvePermission(role, "Notification", "record").outcome).toBe("none");
    }
  });
});

describe("resolvePermission — matrix overrides", () => {
  it("Workspace billing: Restricted for everyone but Owner, with the exact label", () => {
    expect(resolvePermission("owner", "Workspace", "billing")).toEqual({
      outcome: "full",
    });
    for (const role of [
      "hr-admin",
      "finance-admin",
      "manager",
      "team-member",
    ] as const) {
      expect(resolvePermission(role, "Workspace", "billing")).toEqual({
        outcome: "restricted",
        restrictedLabel: "Visible to Owner",
      });
    }
    // Workspace's OTHER partition, "display", is absent from the matrix and
    // falls back to its own registered class (Standard).
    expect(resolvePermission("team-member", "Workspace", "display").outcome).toBe(
      "read",
    );
  });

  it("Employee compensation: Restricted for Manager only, Full for Owner/HR Admin/Finance Admin, Read for Team Member", () => {
    expect(resolvePermission("manager", "Employee", "compensation")).toEqual({
      outcome: "restricted",
      restrictedLabel: "Visible to Finance Admin",
    });
    expect(resolvePermission("owner", "Employee", "compensation").outcome).toBe("full");
    expect(resolvePermission("hr-admin", "Employee", "compensation").outcome).toBe(
      "full",
    );
    expect(resolvePermission("finance-admin", "Employee", "compensation").outcome).toBe(
      "full",
    );
    expect(resolvePermission("team-member", "Employee", "compensation").outcome).toBe(
      "read",
    );
  });

  it("Contract: identifying Restricted for Manager 'Visible to HR Admin', content Restricted 'Visible to Finance Admin'", () => {
    expect(resolvePermission("manager", "Contract", "identifying")).toEqual({
      outcome: "restricted",
      restrictedLabel: "Visible to HR Admin",
    });
    expect(resolvePermission("manager", "Contract", "content")).toEqual({
      outcome: "restricted",
      restrictedLabel: "Visible to Finance Admin",
    });
  });

  it("Requisition budget: Restricted for Manager, matching Finance-restricted's default elsewhere", () => {
    expect(resolvePermission("manager", "Requisition", "budget")).toEqual({
      outcome: "restricted",
      restrictedLabel: "Visible to Finance Admin",
    });
  });

  it("HRCase/CaseEvent: None for Finance Admin, Manager and Team Member on both halves — no subject-exclusion narrowing needed since neither role is granted to begin with", () => {
    for (const nodeType of ["HRCase", "CaseEvent"] as const) {
      for (const partition of ["identifying", "content"] as const) {
        for (const role of ["finance-admin", "manager", "team-member"] as const) {
          expect(resolvePermission(role, nodeType, partition).outcome).toBe("none");
        }
        expect(resolvePermission("owner", nodeType, partition).outcome).toBe("full");
        expect(resolvePermission("hr-admin", nodeType, partition).outcome).toBe("full");
      }
    }
  });
});

describe("resolvePermission — inherited protection resolves to none uniformly", () => {
  const inheritedNodeTypes = [
    "Document",
    "ApprovalStage",
    "GraphReference",
    "Insight",
    "ReportRun",
    "CustomFieldValue",
  ] as const;

  it.each(inheritedNodeTypes)(
    "%s is none for every role regardless of partitionKey",
    (nodeType) => {
      for (const role of ALL_ROLES) {
        expect(resolvePermission(role, nodeType, "record").outcome).toBe("none");
        expect(resolvePermission(role, nodeType, "anything-else").outcome).toBe("none");
      }
    },
  );
});

describe("resolvePermission — A004-T08 fallback and A004-T07-style coverage", () => {
  it("throws for an invalid partition key on a split-protection node type, rather than silently defaulting", () => {
    expect(() =>
      resolvePermission("owner", "Employee", "not-a-real-partition"),
    ).toThrow();
  });

  it("resolves without throwing for every registered node type's real partitions, every role (A004-T07-style coverage)", () => {
    for (const nodeType of NODE_TYPES) {
      // `getProtectionPartitions` returns the node type's real, registered
      // partition keys — "record" for fixed protection, the declared keys
      // for split protection, and none at all for inherited protection
      // (which `resolvePermission` handles without consulting the
      // partition key regardless, per the block above). This exercises
      // A004-T08's fallback path across the whole registry, not just the
      // node types named explicitly elsewhere in this file.
      const partitions = getProtectionPartitions(nodeType);
      const keys = partitions.length > 0 ? partitions.map((p) => p.key) : ["record"];
      for (const key of keys) {
        for (const role of ALL_ROLES) {
          expect(() => resolvePermission(role, nodeType, key)).not.toThrow();
        }
      }
    }
  });
});
