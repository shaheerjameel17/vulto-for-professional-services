import { getProtectionPartitions, NODE_TYPES } from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { POLICY_ROLES, resolvePermission, type PolicyRole } from "./policy-table";

const ALL_ROLES: readonly PolicyRole[] = POLICY_ROLES;

describe("resolvePermission — default class mapping, transcribed from VPS-A004", () => {
  it("Standard: Owner/HR Admin Full, Finance Admin Read — Manager and Team Member none, per F128", () => {
    // LeavePolicy is Standard and absent from the matrix — pure A004-T08
    // default. Standard's own Manager/Team Member cells carry a row-identity
    // qualifier ("Full (direct reports)" / "Read (own + team)"), which this
    // stage cannot resolve — per F128, any cell whose scope is not "any"
    // resolves to `none`, not its literal grant, regardless of role.
    //
    // Separate observation, not fixed here: LeavePolicy is one of eight node
    // types `VPS-A004`'s "workspace-configuration pattern" names as needing
    // a plain, unqualified Read grant for every role — a workspace-wide
    // policy document has no "direct reports" or "own" relationship to any
    // one employee. That pattern has no override row in this table yet, so
    // LeavePolicy falls through to Standard's person-scoped qualifiers
    // instead. `none` is still the safe, correct answer for Manager and
    // Team Member either way; the pattern's own row would resolve to `read`
    // once added.
    expect(resolvePermission("owner", "LeavePolicy", "record").outcome).toBe("full");
    expect(resolvePermission("hr-admin", "LeavePolicy", "record").outcome).toBe("full");
    expect(resolvePermission("finance-admin", "LeavePolicy", "record").outcome).toBe(
      "read",
    );
    expect(resolvePermission("manager", "LeavePolicy", "record").outcome).toBe("none");
    expect(resolvePermission("team-member", "LeavePolicy", "record").outcome).toBe(
      "none",
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

  it("Self-only, absolute: WellnessTriggerEvent — none for every role, Team Member included, per F128", () => {
    // F128. This test previously asserted `team-member` resolves to `full`
    // here — treating the ROLE "Team Member" as though it were the SAME
    // THING as "the specific employee this wellness event belongs to." It
    // is not: Team Member is the role every ordinary employee holds, and
    // resolving it to `full` meant any employee listing WellnessTriggerEvent
    // received every OTHER employee's wellness signals too, not only their
    // own. That directly contradicted `VPS-A004`'s own text, quoted here so
    // the contradiction stays visible: "WellnessTriggerEvent carries the
    // most sensitive data in the graph. Its rule is absolute: only the
    // employee to whom it belongs may traverse to it." A passing test
    // asserting the opposite is what let this ship; see F128 in
    // `docs/Foundations_Findings.md` for the full account, including that
    // it was found only by calling `resolvePermission` directly rather than
    // trusting this suite.
    //
    // `none` for every role, Team Member included, is correct for this
    // stage: "own" is a row-identity qualifier this stage cannot resolve
    // (no User-to-Employee link exists yet), and per F128 every such cell
    // resolves to `none` rather than its literal grant, with no exception
    // for how sensitive or how mundane the underlying data is.
    for (const role of ALL_ROLES) {
      expect(resolvePermission(role, "WellnessTriggerEvent", "record").outcome).toBe(
        "none",
      );
    }
  });

  it("Sensitive resolves to none for every role at the row-level surface this interceptor governs", () => {
    // PulseEntry: Owner/HR Admin get "Aggregate only" in the matrix — the
    // aggregate mechanism (VPS-F005/A004-T12-T15) is not built this stage,
    // and reading "Full" literally here would leak raw survey content.
    // Team Member's "Full (own only)" is the same F128 shape as
    // WellnessTriggerEvent above: an unresolvable row-identity qualifier,
    // not evidence this particular grant is safe to leave open. `none` for
    // every role, uniformly, per F128 — no exception for the role that
    // happens to be the one a genuine owner would hold.
    for (const role of ALL_ROLES) {
      expect(resolvePermission(role, "PulseEntry", "record").outcome).toBe("none");
    }
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
    // falls back to its own registered class (Standard), whose Team Member
    // cell is "Read (own + team)" — a row-identity qualifier this stage
    // cannot resolve. `none`, per F128, same reasoning as LeavePolicy above:
    // a workspace's display fields aren't "owned" by one employee either,
    // so this is arguably the workspace-configuration-pattern gap rather
    // than a genuine "own" case, but the safe answer is identical either way.
    expect(resolvePermission("team-member", "Workspace", "display").outcome).toBe(
      "none",
    );
  });

  it("Employee compensation: Restricted for Manager, Full for Owner/HR Admin/Finance Admin, none for Team Member per F128", () => {
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
    // "Read (own only)" — the employee can read their OWN compensation, per
    // `VPS-A004`. This stage has no row-identity link to know whose "own"
    // that is, so per F128 this resolves to `none` rather than the literal
    // grant, at the cost of a Team Member not seeing their own compensation
    // through this interceptor yet. Correct for a foundations-phase stage
    // with no application feature consuming this query path (F105); revisit
    // once row-level identity exists.
    expect(resolvePermission("team-member", "Employee", "compensation").outcome).toBe(
      "none",
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
