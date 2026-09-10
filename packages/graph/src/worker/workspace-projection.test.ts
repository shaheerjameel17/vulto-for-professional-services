import { describe, expect, it, vi } from "vitest";
import {
  canonicalRoles,
  planProjectionReconciliation,
  PROJECTION_AUTHORIZATION_PATH,
  reconcileWorkspaceProjectionOutbox,
  type WorkspaceProjectionOutboxEntry,
} from "./workspace-projection";

/**
 * The Loro delta builders (`buildWorkspaceAdmissionDelta`,
 * `projectMembership*`) live in `workspace-projection-delta.ts` and use
 * `loro-crdt/web`, which needs a browser WASM init — they are proven in the
 * real-stack browser spec
 * (`services/api/browser-tests-device-store/workspace-membership-projection.spec.ts`).
 * This file covers the pure logic that stays in `workspace-projection.ts`.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const OCCURRED_AT = "2026-02-01T00:00:00.000Z";

describe("canonicalRoles — order- and duplicate-independent", () => {
  it("sorts and de-duplicates so drift comparison is stable", () => {
    expect(canonicalRoles(["hr-admin", "finance-admin"])).toBe(
      canonicalRoles(["finance-admin", "hr-admin"]),
    );
    expect(canonicalRoles(["owner", "owner"])).toBe("owner");
    expect(canonicalRoles(["team-member"])).toBe("team-member");
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

  it("confirms a durable, unconfirmed entry exactly once and marks it; idempotent on re-run", async () => {
    const confirm = vi.fn(async () => {});
    const first = await reconcileWorkspaceProjectionOutbox([entry], {
      isProjectionDurable: () => true,
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(first.confirmed).toEqual([MEMBERSHIP_ID]);
    expect(first.entries[0]!.confirmed).toBe(true);

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
