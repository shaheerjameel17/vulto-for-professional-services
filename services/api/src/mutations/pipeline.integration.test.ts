import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listAuditEntries } from "../audit/journal.js";
import { closeDatabase, db } from "../db.js";
import { graphEdges, graphMutations, graphNodes } from "../graph/schema.js";
import { insertEdge, insertNode } from "../graph/store.js";
import { resolveMemberPrincipal } from "../permission/member-principal.js";
import type { MemberPrincipal } from "../permission/principal.js";
import {
  edgeRecord,
  makeWorkspace,
  nodeRecord,
  NOW,
} from "../permission/test-support.js";
import type { AudienceMaterializer } from "../audience/index.js";
import { applyMutation, applyMutations } from "./pipeline.js";

afterAll(closeDatabase);

/**
 * F208 (open): `managed_by` connects Employee, a split node, but declares no
 * governing partition, so the F136 conservative rule refuses every role and no
 * `org.moveEmployee` can be authorized. These tests pass when the declaration
 * `governingPartitions: { Employee: "operational" }` is present (verified by
 * adding it temporarily). They are skipped until the founder rules on F208;
 * change `itF208` to `it` then.
 */
const itF208 = it.skip;

async function setup(
  others: Record<
    string,
    readonly ("owner" | "hr-admin" | "finance-admin" | "team-member")[]
  > = {},
) {
  const fixture = await makeWorkspace({ member: ["team-member"], ...others });
  const principal = async (name: string): Promise<MemberPrincipal> =>
    (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        userId: fixture.people[name]!.userId,
        workspaceId: fixture.workspaceId,
      }),
    ))!;
  return {
    fixture,
    owner: await principal("owner"),
    member: await principal("member"),
  };
}

const entityNode = (workspaceId: string, nodeId = randomUUID()) => {
  const { workspace_id: _w, ...rest } = nodeRecord("Entity", workspaceId, nodeId);
  return { ...rest, workspace_id: workspaceId };
};

async function employees(workspaceId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (let i = 0; i < count; i += 1) {
      const record = nodeRecord("Employee", workspaceId);
      await insertNode(tx, record);
      ids.push(record.node_id);
    }
  });
  return ids;
}

const nodeRows = (nodeId: string) =>
  db.select().from(graphNodes).where(eq(graphNodes.nodeId, nodeId));

describe("idempotency (A003-T53)", () => {
  it("applies a replayed mutation once and returns the stored outcome as a duplicate", async () => {
    const { fixture, owner } = await setup();
    const nodeId = randomUUID();
    const envelope = {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId, nodeId) },
    };
    const first = await applyMutation(owner, envelope);
    expect(first).toMatchObject({
      status: "applied",
      result: { node_id: nodeId, version: 1 },
    });
    const second = await applyMutation(owner, envelope);
    expect(second).toMatchObject({
      status: "duplicate",
      result: { node_id: nodeId, version: 1 },
    });
    expect(await nodeRows(nodeId)).toHaveLength(1);
    const log = await db
      .select()
      .from(graphMutations)
      .where(eq(graphMutations.mutationId, envelope.mutation_id));
    expect(log).toHaveLength(1);
  });

  it("refuses the same id with different arguments, and never reveals another workspace's outcome", async () => {
    const { fixture, owner } = await setup();
    const id = randomUUID();
    await applyMutation(owner, {
      mutation_id: id,
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId) },
    });
    expect(
      await applyMutation(owner, {
        mutation_id: id,
        name: "graph.createNode",
        args: { node: entityNode(fixture.workspaceId) },
      }),
    ).toEqual({ mutation_id: id, status: "rejected", reason: "mutation-id-conflict" });
    const other = await setup();
    expect(
      await applyMutation(other.owner, {
        mutation_id: id,
        name: "graph.createNode",
        args: { node: entityNode(other.fixture.workspaceId) },
      }),
    ).toEqual({ mutation_id: id, status: "rejected", reason: "mutation-id-conflict" });
  });

  it("replays a rejection as the same rejection", async () => {
    const { fixture, owner } = await setup();
    const envelope = {
      mutation_id: randomUUID(),
      name: "graph.softDeleteNode",
      args: { node_id: randomUUID() },
    };
    const first = await applyMutation(owner, envelope);
    expect(first).toMatchObject({ status: "rejected", reason: "not-found" });
    expect(await applyMutation(owner, envelope)).toEqual(first);
    void fixture;
  });

  it("applies exactly once when the same mutation arrives twice at the same instant", async () => {
    const { fixture, owner } = await setup();
    const nodeId = randomUUID();
    const envelope = {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId, nodeId) },
    };
    const results = await Promise.all([
      applyMutation(owner, envelope),
      applyMutation(owner, envelope),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["applied", "duplicate"]);
    expect(await nodeRows(nodeId)).toHaveLength(1);
  });
});

describe("stale state (A003-T54)", () => {
  it("an approve/reject race ends with exactly one applied and one stale-state", async () => {
    const { fixture, owner } = await setup();
    const [employee] = await employees(fixture.workspaceId, 1);
    const race = (to: string) =>
      applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.transitionLifecycle",
        args: { node_id: employee, to_status: to, expected_version: 1 },
      });
    const results = await Promise.all([race("Inactive"), race("Converted")]);
    expect(results.map((r) => r.status).sort()).toEqual(["applied", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: "stale-state",
    });
    const [row] = await nodeRows(employee!);
    expect(row!.version).toBe(2);
    expect(["Inactive", "Converted"]).toContain(row!.lifecycleStatus);
  });

  it("increments version on every successful update and rejects a stale expected_version without a change", async () => {
    const { fixture, owner } = await setup();
    const nodeId = randomUUID();
    await applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId, nodeId) },
    });
    const update = (expected: number | null, name: string) =>
      applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.updateNodeFields",
        args: {
          node_id: nodeId,
          expected_version: expected,
          patch: { display_name: name },
        },
      });
    expect(await update(1, "A")).toMatchObject({
      status: "applied",
      result: { version: 2 },
    });
    expect(await update(null, "B")).toMatchObject({
      status: "applied",
      result: { version: 3 },
    });
    expect(await update(1, "C")).toMatchObject({
      status: "rejected",
      reason: "stale-state",
    });
    const [row] = await nodeRows(nodeId);
    expect(row).toMatchObject({ version: 3 });
    expect((row!.record as Record<string, unknown>)["display_name"]).toBe("B");
  });
});

describe("org.moveEmployee (A003-T69)", () => {
  const move = (
    owner: MemberPrincipal,
    employee: string,
    manager: string | null,
    from: string,
  ) =>
    applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "org.moveEmployee",
      args: { employee_id: employee, new_manager_id: manager, effective_from: from },
    });

  itF208(
    "rejects a direct loop A->B->A and a longer loop, and accepts the clean move",
    async () => {
      const { fixture, owner } = await setup();
      const [a, b, c] = await employees(fixture.workspaceId, 3);
      expect(await move(owner, a!, b!, "2026-01-01T00:00:00.000Z")).toMatchObject({
        status: "applied",
      });
      expect(await move(owner, b!, a!, "2026-02-01T00:00:00.000Z")).toMatchObject({
        status: "rejected",
        reason: "cycle",
      });
      expect(await move(owner, b!, c!, "2026-02-01T00:00:00.000Z")).toMatchObject({
        status: "applied",
      });
      // c managing a would close a -> b -> c -> a.
      expect(await move(owner, c!, a!, "2026-03-01T00:00:00.000Z")).toMatchObject({
        status: "rejected",
        reason: "cycle",
      });
      expect(await move(owner, a!, a!, "2026-03-01T00:00:00.000Z")).toMatchObject({
        status: "rejected",
        reason: "cycle",
      });
    },
  );

  itF208(
    "closes the prior edge and opens the new one at the same instant, half-open and never overlapping",
    async () => {
      const { fixture, owner } = await setup();
      const [a, b, c] = await employees(fixture.workspaceId, 3);
      await move(owner, a!, b!, "2026-01-01T00:00:00.000Z");
      const moved = await move(owner, a!, c!, "2026-06-01T00:00:00.000Z");
      expect(moved.status).toBe("applied");
      const edges = await db
        .select()
        .from(graphEdges)
        .where(eq(graphEdges.fromNodeId, a!))
        .orderBy(graphEdges.effectiveFrom);
      expect(edges).toHaveLength(2);
      expect(edges[0]!.effectiveTo!.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(edges[1]!.effectiveFrom!.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(edges[1]!.effectiveTo).toBeNull();
      // The database itself refuses any overlap.
      await expect(
        db.transaction((tx) =>
          insertEdge(
            tx,
            fixture.workspaceId,
            edgeRecord(
              "managed_by",
              a!,
              b!,
              "2026-03-01T00:00:00.000Z",
              "2026-04-01T00:00:00.000Z",
            ),
          ),
        ),
      ).rejects.toThrow();
    },
  );

  itF208(
    "takes the effective date from the caller, ends a reporting line with null, and refuses a no-op",
    async () => {
      const { fixture, owner } = await setup();
      const [a, b] = await employees(fixture.workspaceId, 2);
      await move(owner, a!, b!, "2026-01-01T00:00:00.000Z");
      expect(await move(owner, a!, b!, "2026-02-01T00:00:00.000Z")).toMatchObject({
        status: "rejected",
        reason: "no-change",
      });
      expect(await move(owner, a!, null, "2026-05-01T00:00:00.000Z")).toMatchObject({
        status: "applied",
      });
      const open = await db
        .select()
        .from(graphEdges)
        .where(eq(graphEdges.fromNodeId, a!));
      expect(open.every((edge) => edge.effectiveTo !== null)).toBe(true);
    },
  );

  itF208(
    "settles two moves that would each become the other's manager: one commits, the other is a cycle",
    async () => {
      const { fixture, owner } = await setup();
      const [a, b] = await employees(fixture.workspaceId, 2);
      const results = await Promise.all([
        move(owner, a!, b!, "2026-01-01T00:00:00.000Z"),
        move(owner, b!, a!, "2026-01-01T00:00:00.000Z"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["applied", "rejected"]);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: "cycle",
      });
    },
  );
});

describe("authorization and audit", () => {
  it("a denied mutation writes an audit row and a rejection, and changes nothing in the graph", async () => {
    const { fixture, member } = await setup();
    const nodeId = randomUUID();
    const before = await db.execute(
      sql`select count(*)::int as n from graph_nodes where workspace_id = ${fixture.workspaceId}`,
    );
    const result = await applyMutation(member, {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId, nodeId) },
    });
    expect(result).toMatchObject({ status: "rejected", reason: "role" });
    expect(await nodeRows(nodeId)).toHaveLength(0);
    const after = await db.execute(
      sql`select count(*)::int as n from graph_nodes where workspace_id = ${fixture.workspaceId}`,
    );
    expect(after).toEqual(before);
    const audit = await listAuditEntries(db, fixture.workspaceId);
    expect(
      audit.filter(
        (e) => e.event_type === "PermissionDenied" && e.actor_user_id === member.userId,
      ),
    ).toHaveLength(1);
    const [log] = await db
      .select()
      .from(graphMutations)
      .where(eq(graphMutations.mutationId, result.mutation_id));
    expect(log!.outcome).toEqual({ status: "rejected", reason: "role" });
  });

  it("never lets a client claim provenance: the server stamps who and when", async () => {
    const { fixture, owner } = await setup();
    const nodeId = randomUUID();
    const forged = {
      ...entityNode(fixture.workspaceId, nodeId),
      created_by: randomUUID(),
      created_at: "2001-01-01T00:00:00.000Z",
    };
    await applyMutation(
      owner,
      { mutation_id: randomUUID(), name: "graph.createNode", args: { node: forged } },
      { now: () => "2026-09-21T10:00:00.000Z" },
    );
    const [row] = await nodeRows(nodeId);
    const record = row!.record as Record<string, unknown>;
    expect(record["created_by"]).toBe(owner.userId);
    expect(record["created_at"]).toBe("2026-09-21T10:00:00.000Z");
  });

  it("refuses the reserved records and AuditEntry on the generic path", async () => {
    const { fixture, owner } = await setup();
    for (const type of ["WorkspaceMembership", "AuditEntry"]) {
      const record = nodeRecord(type, fixture.workspaceId);
      expect(
        await applyMutation(owner, {
          mutation_id: randomUUID(),
          name: "graph.createNode",
          args: { node: record },
        }),
      ).toMatchObject({ status: "rejected" });
      expect(await nodeRows(record.node_id)).toHaveLength(0);
    }
  });
});

describe("generic mutations are Tier 0 only", () => {
  it("refuses a split or protected node type with requires-feature-mutation, on create and update", async () => {
    const { fixture, owner } = await setup();
    for (const type of ["Employee", "PayRun", "HRCase"]) {
      const record = nodeRecord(type, fixture.workspaceId);
      const created = await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.createNode",
        args: { node: record },
      });
      // A type the Owner cannot write at all is refused earlier; a permitted one reaches the Tier 0 rule.
      expect(created.status).toBe("rejected");
      expect(await nodeRows(record.node_id)).toHaveLength(0);
    }
    const [employee] = await employees(fixture.workspaceId, 1);
    expect(
      await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.updateNodeFields",
        args: {
          node_id: employee,
          expected_version: null,
          patch: { display_name: "x" },
        },
      }),
    ).toMatchObject({ status: "rejected", reason: "requires-feature-mutation" });
    expect(
      await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.createNode",
        args: { node: nodeRecord("Employee", fixture.workspaceId) },
      }),
    ).toMatchObject({ status: "rejected", reason: "requires-feature-mutation" });
  });
});

describe("ordered batches", () => {
  it("stops at the first rejection and returns the rest as blocked, in order", async () => {
    const { fixture, owner } = await setup();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const results = await applyMutations(owner, [
      {
        mutation_id: ids[0]!,
        name: "graph.createNode",
        args: { node: entityNode(fixture.workspaceId) },
      },
      {
        mutation_id: ids[1]!,
        name: "graph.softDeleteNode",
        args: { node_id: randomUUID() },
      },
      {
        mutation_id: ids[2]!,
        name: "graph.createNode",
        args: { node: entityNode(fixture.workspaceId) },
      },
    ]);
    expect(results.map((r) => [r.mutation_id, r.status, r.reason])).toEqual([
      [ids[0], "applied", undefined],
      [ids[1], "rejected", "not-found"],
      [ids[2], "rejected", "blocked-by-earlier-rejection"],
    ]);
    // The blocked one was not run and is not logged, so it can be resent.
    expect(
      await db
        .select()
        .from(graphMutations)
        .where(eq(graphMutations.mutationId, ids[2]!)),
    ).toHaveLength(0);
  });

  it("rejects unknown mutations and malformed arguments", async () => {
    const { owner } = await setup();
    expect(
      await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "nope.nothing",
        args: {},
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "unknown-mutation",
    });
    expect(
      await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.createNode",
        args: { extra: 1 },
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "invalid-args",
    });
  });
});

describe("the pipeline's remaining steps", () => {
  itF208(
    "calls the audience seam with every row it touched, inside the transaction",
    async () => {
      const { fixture, owner } = await setup();
      const [a, b] = await employees(fixture.workspaceId, 2);
      const seen: string[][] = [];
      const audience: AudienceMaterializer = {
        async onRowsChanged(_tx, ids) {
          seen.push([...ids]);
        },
      };
      const result = await applyMutation(
        owner,
        {
          mutation_id: randomUUID(),
          name: "org.moveEmployee",
          args: { employee_id: a, new_manager_id: b, effective_from: NOW },
        },
        { audience },
      );
      expect(result.status).toBe("applied");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual([
        (result.result as { opened_edge_id: string }).opened_edge_id,
      ]);
    },
  );

  it("rolls everything back if the audience seam fails", async () => {
    const { fixture, owner } = await setup();
    const nodeId = randomUUID();
    const envelope = {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: entityNode(fixture.workspaceId, nodeId) },
    };
    await expect(
      applyMutation(owner, envelope, {
        audience: {
          async onRowsChanged() {
            throw new Error("audience unavailable");
          },
        },
      }),
    ).rejects.toThrow("audience unavailable");
    expect(await nodeRows(nodeId)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(graphMutations)
        .where(eq(graphMutations.mutationId, envelope.mutation_id)),
    ).toHaveLength(0);
  });

  itF208("closes and creates edges through the named mutations", async () => {
    const { fixture, owner } = await setup();
    const [a, b] = await employees(fixture.workspaceId, 2);
    const edge = edgeRecord("managed_by", a!, b!, "2026-01-01T00:00:00.000Z");
    const created = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "graph.createEdge",
      args: { edge },
    });
    expect(created).toMatchObject({
      status: "applied",
      result: { edge_id: edge.edge_id },
    });
    const closed = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "graph.closeEdge",
      args: { edge_id: edge.edge_id, effective_to: "2026-02-01T00:00:00.000Z" },
    });
    expect(closed).toMatchObject({ status: "applied", result: { version: 2 } });
    expect(
      await applyMutation(owner, {
        mutation_id: randomUUID(),
        name: "graph.closeEdge",
        args: { edge_id: edge.edge_id, effective_to: "2026-03-01T00:00:00.000Z" },
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid-args" });
  });
});
