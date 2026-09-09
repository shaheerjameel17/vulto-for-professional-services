import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { readEdgeFragments } from "./document-edge-fragments";
import { readNodeFragments } from "./document-node-fragments";
import { validateGraphSnapshot } from "./materialization";
import { materializeManagedByEdges } from "./managed-by-materialization";
import { authorizeMutationBatch } from "./permission/mutation-interceptor";
import {
  acceptProjectionGrant,
  acceptTransitionGrant,
  buildWorkspaceAdmissionDelta,
  canonicalRoles,
  planProjectionReconciliation,
  PROJECTION_AUTHORIZATION_PATH,
  projectMembershipRevocation,
  projectMembershipRoleChange,
  projectWorkspaceAdmission,
  reconcileWorkspaceProjectionOutbox,
  type WorkspaceProjectionOutboxEntry,
} from "./workspace-projection";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OF_EDGE_ID = "44444444-4444-4444-8444-444444444444";
const IN_EDGE_ID = "55555555-5555-4555-8555-555555555555";
const OCCURRED_AT = "2026-02-01T00:00:00.000Z";

const grant = acceptProjectionGrant({
  workspaceId: WORKSPACE_ID,
  membershipId: MEMBERSHIP_ID,
  userId: USER_ID,
  roles: ["owner"],
  membershipOfEdgeId: OF_EDGE_ID,
  membershipInEdgeId: IN_EDGE_ID,
});

const details = {
  workspaceName: "Northwind Consulting",
  actorUserId: USER_ID,
  occurredAt: OCCURRED_AT,
};

function loadDelta(bytes: Uint8Array): LoroDoc {
  const document = new LoroDoc();
  document.import(bytes);
  return document;
}

describe("buildWorkspaceAdmissionDelta — exactly the five reserved-type records", () => {
  it("writes three node fragments (Workspace, User, WorkspaceMembership) and two edges", () => {
    const document = loadDelta(buildWorkspaceAdmissionDelta(grant, details));
    const nodes = readNodeFragments(document);
    const edges = readEdgeFragments(document);

    expect(
      nodes.map((n) => (n.record as Record<string, unknown>).node_type).sort(),
    ).toEqual(["User", "Workspace", "WorkspaceMembership"]);
    expect(
      edges.map((e) => (e.record as Record<string, unknown>).edge_type).sort(),
    ).toEqual(["membership_in", "membership_of"]);
    document.free();
  });

  it("produces the UNSCOPED shape for User and Workspace — no workspace_id", () => {
    const document = loadDelta(buildWorkspaceAdmissionDelta(grant, details));
    for (const fragment of readNodeFragments(document)) {
      const record = fragment.record as Record<string, unknown>;
      if (record.node_type === "User" || record.node_type === "Workspace") {
        expect(record).not.toHaveProperty("workspace_id");
      }
      if (record.node_type === "WorkspaceMembership") {
        expect(record.workspace_id).toBe(WORKSPACE_ID);
        expect(record.role).toBe("owner");
      }
    }
    document.free();
  });

  it("the Workspace node id is the workspace id; edges run WorkspaceMembership -> {User, Workspace}", () => {
    const document = loadDelta(buildWorkspaceAdmissionDelta(grant, details));
    const workspace = readNodeFragments(document).find(
      (n) => (n.record as Record<string, unknown>).node_type === "Workspace",
    )!;
    expect((workspace.record as Record<string, unknown>).node_id).toBe(WORKSPACE_ID);

    const edges = readEdgeFragments(document).map(
      (e) => e.record as Record<string, unknown>,
    );
    const of = edges.find((e) => e.edge_type === "membership_of")!;
    const inn = edges.find((e) => e.edge_type === "membership_in")!;
    expect([of.from_node_id, of.to_node_id]).toEqual([MEMBERSHIP_ID, USER_ID]);
    expect([inn.from_node_id, inn.to_node_id]).toEqual([MEMBERSHIP_ID, WORKSPACE_ID]);
    expect(of.edge_id).toBe(OF_EDGE_ID);
    expect(inn.edge_id).toBe(IN_EDGE_ID);
    document.free();
  });

  it("materializes coherently through validateGraphSnapshot for its own workspace", async () => {
    const document = loadDelta(buildWorkspaceAdmissionDelta(grant, details));
    const { edges: managedBy } = await materializeManagedByEdges(document);
    const validated = validateGraphSnapshot(
      {
        nodeFragments: readNodeFragments(document),
        edges: [...managedBy, ...readEdgeFragments(document)],
      },
      WORKSPACE_ID,
    );
    expect(validated.nodeFragments).toHaveLength(3);
    expect(validated.edges).toHaveLength(2);
    document.free();
  });

  it("is byte-identical for the same grant and details — deterministic, so re-projection is idempotent", () => {
    const a = buildWorkspaceAdmissionDelta(grant, details);
    const b = buildWorkspaceAdmissionDelta(grant, details);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("the projection delta cannot go through the generic mutate gate", () => {
  it("authorizeMutationBatch refuses it as unsupported — only the privileged command may write it", async () => {
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [buildWorkspaceAdmissionDelta(grant, details)],
      ["owner"],
      WORKSPACE_ID,
    );
    expect(outcome.status).toBe("unsupported");
    document.free();
  });
});

describe("projectWorkspaceAdmission — the outbox entry and its audit marker", () => {
  it("records the privileged-exception path, distinguishable from an ordinary authorized write", () => {
    const { outboxEntry } = projectWorkspaceAdmission(grant, details);
    expect(outboxEntry.authorizationPath).toBe(PROJECTION_AUTHORIZATION_PATH);
    expect(outboxEntry.authorizationPath).toBe("privileged-projection-exception");
    expect(outboxEntry).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      workspaceId: WORKSPACE_ID,
      committedLocally: false,
      confirmed: false,
    });
  });
});

describe("reconcileWorkspaceProjectionOutbox", () => {
  const entry: WorkspaceProjectionOutboxEntry = {
    kind: "admission",
    membershipId: MEMBERSHIP_ID,
    workspaceId: WORKSPACE_ID,
    authorizationPath: PROJECTION_AUTHORIZATION_PATH,
    createdAt: OCCURRED_AT,
    committedLocally: false,
    confirmed: false,
  };

  it("does not confirm an entry whose projection is not yet durable", async () => {
    const confirm = vi.fn(async () => {});
    const result = await reconcileWorkspaceProjectionOutbox([entry], {
      isProjectionDurable: () => false,
      confirm,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(result.confirmed).toEqual([]);
    expect(result.entries[0]!.confirmed).toBe(false);
  });

  it("confirms a durable, unconfirmed entry exactly once and marks it", async () => {
    const confirm = vi.fn(async () => {});
    const first = await reconcileWorkspaceProjectionOutbox([entry], {
      isProjectionDurable: () => true,
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(first.confirmed).toEqual([MEMBERSHIP_ID]);
    expect(first.entries[0]!.confirmed).toBe(true);

    // Idempotent: a second pass over the already-confirmed entry is a no-op.
    const second = await reconcileWorkspaceProjectionOutbox(first.entries, {
      isProjectionDurable: () => true,
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(second.confirmed).toEqual([]);
  });

  it("propagates a confirm failure without marking the entry confirmed", async () => {
    const confirm = vi.fn(async () => {
      throw new Error("server said no");
    });
    await expect(
      reconcileWorkspaceProjectionOutbox([entry], {
        isProjectionDurable: () => true,
        confirm,
      }),
    ).rejects.toThrow("server said no");
  });
});

// ── Stage 3: revocation and role-change projection ──────────────────────────

describe("projectMembershipRevocation / projectMembershipRoleChange — one WM record", () => {
  const revGrant = acceptTransitionGrant({
    kind: "revocation",
    workspaceId: WORKSPACE_ID,
    membershipId: MEMBERSHIP_ID,
    roles: ["owner"],
  });
  const roleGrant = acceptTransitionGrant({
    kind: "role-change",
    workspaceId: WORKSPACE_ID,
    membershipId: MEMBERSHIP_ID,
    roles: ["hr-admin", "finance-admin"],
  });

  it("revocation delta is one WorkspaceMembership fragment with lifecycle_status Revoked", () => {
    const document = loadDelta(projectMembershipRevocation(revGrant, details).delta);
    const nodes = readNodeFragments(document);
    expect(nodes).toHaveLength(1);
    const record = nodes[0]!.record as Record<string, unknown>;
    expect(record.node_type).toBe("WorkspaceMembership");
    expect(record.lifecycle_status).toBe("Revoked");
    expect(record.workspace_id).toBe(WORKSPACE_ID);
    expect(readEdgeFragments(document)).toHaveLength(0);
    document.free();
  });

  it("role-change delta records the new canonical role set, lifecycle_status Active", () => {
    const document = loadDelta(projectMembershipRoleChange(roleGrant, details).delta);
    const record = readNodeFragments(document)[0]!.record as Record<string, unknown>;
    expect(record.lifecycle_status).toBe("Active");
    expect(record.role).toBe(canonicalRoles(["hr-admin", "finance-admin"]));
    document.free();
  });

  it("both refuse a grant of the wrong kind", () => {
    expect(() => projectMembershipRevocation(roleGrant, details)).toThrow();
    expect(() => projectMembershipRoleChange(revGrant, details)).toThrow();
  });

  it("the generic mutate gate refuses a revocation/role-change delta too", async () => {
    for (const bytes of [
      projectMembershipRevocation(revGrant, details).delta,
      projectMembershipRoleChange(roleGrant, details).delta,
    ]) {
      const document = new LoroDoc();
      const outcome = await authorizeMutationBatch(
        document,
        [bytes],
        ["owner"],
        WORKSPACE_ID,
      );
      expect(outcome.status).toBe("unsupported");
      document.free();
    }
  });

  it("materializes coherently and carries the exception audit marker", async () => {
    const projection = projectMembershipRevocation(revGrant, details);
    expect(projection.outboxEntry).toMatchObject({
      kind: "revocation",
      authorizationPath: "privileged-projection-exception",
    });
    const document = loadDelta(projection.delta);
    const { edges } = await materializeManagedByEdges(document);
    const validated = validateGraphSnapshot(
      { nodeFragments: readNodeFragments(document), edges },
      WORKSPACE_ID,
    );
    expect(validated.nodeFragments).toHaveLength(1);
    document.free();
  });
});

describe("planProjectionReconciliation — the four triggers", () => {
  const base = {
    membershipId: MEMBERSHIP_ID,
    workspaceId: WORKSPACE_ID,
    outbox: [] as WorkspaceProjectionOutboxEntry[],
    now: Date.parse("2026-02-01T01:00:00.000Z"),
    confirmDeadlineMs: 60_000,
  };

  it("startup/unlock compare: confirmed grant but no projected node -> re-project admission", () => {
    const actions = planProjectionReconciliation({
      ...base,
      grant: { status: "confirmed", roles: ["owner"] },
      projected: null,
    });
    expect(actions).toContainEqual({
      type: "re-project",
      kind: "admission",
      reason: "startup-missing-projection",
    });
  });

  it("F127 poll drift: grant role set differs from the projected node's role -> re-project role-change", () => {
    const actions = planProjectionReconciliation({
      ...base,
      grant: { status: "confirmed", roles: ["hr-admin"] },
      projected: { lifecycleStatus: "Active", role: canonicalRoles(["owner"]) },
    });
    expect(actions).toContainEqual({
      type: "re-project",
      kind: "role-change",
      reason: "poll-role-drift",
    });
  });

  it("no drift when grant and projected role sets match (order-independent)", () => {
    const actions = planProjectionReconciliation({
      ...base,
      grant: { status: "confirmed", roles: ["finance-admin", "hr-admin"] },
      projected: {
        lifecycleStatus: "Active",
        role: canonicalRoles(["hr-admin", "finance-admin"]),
      },
    });
    expect(actions).toEqual([]);
  });

  it("server-initiated: grant revoked but projected node still Active -> re-project revocation", () => {
    const actions = planProjectionReconciliation({
      ...base,
      grant: { status: "revoked" },
      projected: { lifecycleStatus: "Active", role: canonicalRoles(["owner"]) },
    });
    expect(actions).toContainEqual({
      type: "re-project",
      kind: "revocation",
      reason: "revocation-not-projected",
    });
  });

  it("outbox deadline: an unconfirmed entry older than the deadline -> retry-confirm", () => {
    const stale: WorkspaceProjectionOutboxEntry = {
      kind: "admission",
      membershipId: MEMBERSHIP_ID,
      workspaceId: WORKSPACE_ID,
      authorizationPath: PROJECTION_AUTHORIZATION_PATH,
      createdAt: "2026-02-01T00:00:00.000Z",
      committedLocally: true,
      confirmed: false,
    };
    const actions = planProjectionReconciliation({
      ...base,
      grant: { status: "confirmed", roles: ["owner"] },
      projected: { lifecycleStatus: "Active", role: canonicalRoles(["owner"]) },
      outbox: [stale],
    });
    expect(actions).toContainEqual({ type: "retry-confirm", entry: stale });
  });
});
