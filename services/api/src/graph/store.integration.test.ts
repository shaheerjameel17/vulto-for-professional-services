import { randomUUID } from "node:crypto";
import { NODE_REGISTRY } from "@vulto/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createPendingWorkspaceAdmission } from "../auth/workspace-session.js";
import { user } from "../auth/schema.js";
import { closeDatabase, db } from "../db.js";
import { graphEdges, graphNodes } from "./schema.js";
import { writeMembershipUser } from "./membership-projection.js";
import {
  closeEdge,
  getNode,
  getNodes,
  GraphNotFoundError,
  GraphValidationError,
  incoming,
  insertEdge,
  insertNode,
  insertUserNode,
  outgoing,
  softDeleteNode,
  StaleVersionError,
  traverse,
  updateNodeFields,
  type GraphTx,
} from "./store.js";

afterAll(closeDatabase);

const NOW = "2026-09-21T09:00:00.000Z";
const ACTOR = randomUUID();

/** The Postgres error code, whether or not Drizzle wrapped the driver error. */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

function nodeRecord(nodeType: string, workspaceId: string, nodeId = randomUUID()) {
  const registration = NODE_REGISTRY.find((r) => r.nodeType === nodeType)!;
  const lifecycle =
    registration.lifecycle.kind === "fixed"
      ? registration.lifecycle.statuses[0]
      : "Active";
  const id = nodeType === "Workspace" ? workspaceId : nodeId;
  const scoped = nodeType !== "Workspace" && nodeType !== "User";
  const base = {
    node_id: id,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: lifecycle,
    ...(scoped ? { workspace_id: workspaceId } : {}),
  };
  if (registration.universalFields === "anonymous-contribution") {
    return { ...base, is_soft_deleted: false };
  }
  if (registration.universalFields === "immutable-audit") {
    return { ...base, created_at: NOW, created_by: ACTOR };
  }
  return {
    ...base,
    created_at: NOW,
    created_by: ACTOR,
    updated_at: NOW,
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

function edgeRecord(
  edgeType: string,
  from: string,
  to: string,
  effectiveFrom: string | null = NOW,
  effectiveTo: string | null = null,
) {
  return {
    edge_id: randomUUID(),
    edge_type: edgeType,
    from_node_id: from,
    to_node_id: to,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    created_at: NOW,
    created_by: ACTOR,
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

async function newWorkspace(tx: GraphTx): Promise<string> {
  const workspaceId = randomUUID();
  await insertNode(tx, nodeRecord("Workspace", workspaceId));
  return workspaceId;
}

async function employee(tx: GraphTx, workspaceId: string): Promise<string> {
  const record = nodeRecord("Employee", workspaceId);
  await insertNode(tx, record);
  return record.node_id;
}

describe("Stage 2 — the canonical graph store", () => {
  it("round-trips every registered node type", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      for (const { nodeType } of NODE_REGISTRY) {
        // F198: AuditEntry is written only by appendAudit; see audit.integration.test.ts.
        if (nodeType === "AuditEntry") continue;
        const record = nodeRecord(nodeType, workspaceId);
        if (nodeType === "User") await writeMembershipUser(tx, workspaceId, record);
        else if (nodeType !== "Workspace") await insertNode(tx, record);
        const stored = await getNode(tx, workspaceId, record.node_id);
        expect(stored, nodeType).not.toBeNull();
        expect(stored!.nodeType).toBe(nodeType);
        expect(stored!.version).toBe(1);
        expect(stored!.record).toEqual(record);
      }
      // The Workspace was written by newWorkspace; every other registered type,
      // including the anonymity-protected contributions, went through the store.
      const stored = await getNodes(tx, workspaceId, { includeSoftDeleted: true });
      expect(new Set(stored.map((n) => n.nodeType))).toEqual(
        new Set(NODE_REGISTRY.map((r) => r.nodeType).filter((t) => t !== "AuditEntry")),
      );
    });
  });

  it("refuses AuditEntry on every generic write path (F198)", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const record = nodeRecord("AuditEntry", workspaceId);
      await expect(insertNode(tx, record)).rejects.toThrow(/appendAudit/);
    });
  });

  it("stores the anonymity-protected contributions with no created_at (F205)", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      for (const type of [
        "PulseAggregateContribution",
        "WellnessAggregateContribution",
      ]) {
        const record = nodeRecord(type, workspaceId);
        const stored = await insertNode(tx, record);
        expect(stored.record).not.toHaveProperty("created_at");
        const [row] = await tx
          .select({ createdAt: graphNodes.createdAt, createdBy: graphNodes.createdBy })
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.workspaceId, workspaceId),
              eq(graphNodes.nodeId, record.node_id),
            ),
          );
        expect(row).toEqual({ createdAt: null, createdBy: null });
      }
    });
  });

  it("refuses a null created_at for any other node type, at the database", async () => {
    const code = await pgCode(
      db.transaction(async (tx) => {
        const workspaceId = await newWorkspace(tx);
        const id = randomUUID();
        await tx.insert(graphNodes).values({
          nodeId: id,
          workspaceId,
          nodeType: "Employee",
          lifecycleStatus: "Active",
          schemaVersion: 1,
          record: { node_id: id, lifecycle_status: "Active" },
        });
      }),
    );
    expect(code).toBe("23514");
  });

  it("stores only universal fields for a type with no Tier 0 partition", async () => {
    const protectedType = NODE_REGISTRY.find(
      (r) => r.protection.kind === "fixed" && r.protection.tier > 0,
    )!.nodeType;
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const record = {
        ...nodeRecord(protectedType, workspaceId),
        secret_field: "SENTINEL",
      };
      const stored = await insertNode(tx, record);
      expect(stored.record).not.toHaveProperty("secret_field");
      expect(JSON.stringify(stored.record)).not.toContain("SENTINEL");
    });
  });

  it("stores no edge metadata when an endpoint has a protected partition", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const a = await employee(tx, workspaceId);
      const b = await employee(tx, workspaceId);
      const edge = await insertEdge(tx, workspaceId, {
        ...edgeRecord("managed_by", a, b),
        metadata: { note: "SENTINEL" },
      });
      expect(edge.record["metadata"]).toEqual({});
    });
  });

  it("throws GraphValidationError for an unregistered edge triple", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const a = await employee(tx, workspaceId);
      const entity = nodeRecord("Entity", workspaceId);
      await insertNode(tx, entity);
      // managed_by is Employee -> Employee only.
      await expect(
        insertEdge(tx, workspaceId, edgeRecord("managed_by", a, entity.node_id)),
      ).rejects.toBeInstanceOf(GraphValidationError);
    });
  });

  it("throws GraphValidationError for an invalid record and for a missing endpoint", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      await expect(insertNode(tx, { node_type: "Employee" })).rejects.toBeInstanceOf(
        GraphValidationError,
      );
      await expect(
        insertNode(tx, { ...nodeRecord("Employee", workspaceId), node_type: "Nope" }),
      ).rejects.toBeInstanceOf(GraphValidationError);
      const a = await employee(tx, workspaceId);
      await expect(
        insertEdge(tx, workspaceId, edgeRecord("managed_by", a, randomUUID())),
      ).rejects.toBeInstanceOf(GraphValidationError);
    });
  });

  it("rejects two open managed_by edges from one employee at the database", async () => {
    const code = await pgCode(
      db.transaction(async (tx) => {
        const workspaceId = await newWorkspace(tx);
        const a = await employee(tx, workspaceId);
        const b = await employee(tx, workspaceId);
        const c = await employee(tx, workspaceId);
        await insertEdge(tx, workspaceId, edgeRecord("managed_by", a, b));
        await insertEdge(
          tx,
          workspaceId,
          edgeRecord("managed_by", a, c, "2026-10-01T00:00:00.000Z"),
        );
      }),
    );
    // Both the partial unique index (23505) and the exclusion constraint
    // (23P01) forbid this; either one may report it first.
    expect(["23505", "23P01"]).toContain(code);
  });

  it("rejects overlapping closed scoped_to_entity intervals and allows adjacent ones", async () => {
    const overlapping = await pgCode(
      db.transaction(async (tx) => {
        const workspaceId = await newWorkspace(tx);
        const a = await employee(tx, workspaceId);
        const e1 = nodeRecord("Entity", workspaceId);
        const e2 = nodeRecord("Entity", workspaceId);
        await insertNode(tx, e1);
        await insertNode(tx, e2);
        await insertEdge(
          tx,
          workspaceId,
          edgeRecord(
            "scoped_to_entity",
            a,
            e1.node_id,
            "2026-01-01T00:00:00.000Z",
            "2026-03-01T00:00:00.000Z",
          ),
        );
        await insertEdge(
          tx,
          workspaceId,
          edgeRecord(
            "scoped_to_entity",
            a,
            e2.node_id,
            "2026-02-01T00:00:00.000Z",
            "2026-04-01T00:00:00.000Z",
          ),
        );
      }),
    );
    expect(overlapping).toBe("23P01");

    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const a = await employee(tx, workspaceId);
      const e1 = nodeRecord("Entity", workspaceId);
      const e2 = nodeRecord("Entity", workspaceId);
      await insertNode(tx, e1);
      await insertNode(tx, e2);
      await insertEdge(
        tx,
        workspaceId,
        edgeRecord(
          "scoped_to_entity",
          a,
          e1.node_id,
          "2026-01-01T00:00:00.000Z",
          "2026-02-01T00:00:00.000Z",
        ),
      );
      await insertEdge(
        tx,
        workspaceId,
        edgeRecord(
          "scoped_to_entity",
          a,
          e2.node_id,
          "2026-02-01T00:00:00.000Z",
          "2026-03-01T00:00:00.000Z",
        ),
      );
    });
  });

  it("rejects a stale expectedVersion and leaves the version unchanged", async () => {
    const workspaceId = randomUUID();
    const nodeId = randomUUID();
    await db.transaction(async (tx) => {
      await insertNode(tx, nodeRecord("Workspace", workspaceId));
      await insertNode(tx, nodeRecord("Employee", workspaceId, nodeId));
    });
    await expect(
      db.transaction((tx) =>
        updateNodeFields(tx, workspaceId, nodeId, 5, {
          lifecycle_status: "Active",
          updated_at: NOW,
          updated_by: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await db.transaction(async (tx) => {
      expect((await getNode(tx, workspaceId, nodeId))!.version).toBe(1);
    });
  });

  it("increments version on update, merges fields, and refuses identity changes", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const record = nodeRecord("Employee", workspaceId);
      await insertNode(tx, record);
      const updated = await updateNodeFields(tx, workspaceId, record.node_id, 1, {
        display_name: "Avery",
        updated_at: "2026-09-22T00:00:00.000Z",
        updated_by: ACTOR,
      });
      expect(updated.version).toBe(2);
      expect(updated.record["display_name"]).toBe("Avery");
      expect(updated.record["created_at"]).toBe(NOW);
      await expect(
        updateNodeFields(tx, workspaceId, record.node_id, null, {
          node_type: "Entity",
        }),
      ).rejects.toBeInstanceOf(GraphValidationError);
      await expect(
        updateNodeFields(tx, workspaceId, randomUUID(), null, {}),
      ).rejects.toBeInstanceOf(GraphNotFoundError);
    });
  });

  it("soft-deletes and hides the node from default reads", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const record = nodeRecord("Employee", workspaceId);
      await insertNode(tx, record);
      const deleted = await softDeleteNode(tx, workspaceId, record.node_id, {
        userId: ACTOR,
        at: "2026-09-22T00:00:00.000Z",
      });
      expect(deleted.isSoftDeleted).toBe(true);
      expect(deleted.version).toBe(2);
      expect(await getNodes(tx, workspaceId, { nodeType: "Employee" })).toHaveLength(0);
      expect(
        await getNodes(tx, workspaceId, {
          nodeType: "Employee",
          includeSoftDeleted: true,
        }),
      ).toHaveLength(1);
    });
  });

  it("closes an edge, increments its version, and answers point-in-time queries", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const a = await employee(tx, workspaceId);
      const b = await employee(tx, workspaceId);
      const c = await employee(tx, workspaceId);
      const first = await insertEdge(
        tx,
        workspaceId,
        edgeRecord("managed_by", a, b, "2026-01-01T00:00:00.000Z"),
      );
      const closed = await closeEdge(
        tx,
        workspaceId,
        first.edgeId,
        "2026-06-01T00:00:00.000Z",
        {
          userId: ACTOR,
          at: NOW,
        },
      );
      expect(closed.version).toBe(2);
      expect(closed.effectiveTo).toBe("2026-06-01T00:00:00.000Z");
      await expect(
        closeEdge(tx, workspaceId, first.edgeId, "2026-07-01T00:00:00.000Z", {
          userId: ACTOR,
          at: NOW,
        }),
      ).rejects.toBeInstanceOf(GraphValidationError);
      await insertEdge(
        tx,
        workspaceId,
        edgeRecord("managed_by", a, c, "2026-06-01T00:00:00.000Z"),
      );

      const before = await outgoing(
        tx,
        workspaceId,
        a,
        "managed_by",
        "2026-03-01T00:00:00.000Z",
      );
      expect(before.map((e) => e.toNodeId)).toEqual([b]);
      const boundary = await outgoing(
        tx,
        workspaceId,
        a,
        "managed_by",
        "2026-06-01T00:00:00.000Z",
      );
      expect(boundary.map((e) => e.toNodeId)).toEqual([c]);
      expect(await outgoing(tx, workspaceId, a, "managed_by")).toHaveLength(2);
      expect(
        (await incoming(tx, workspaceId, b, "managed_by")).map((e) => e.fromNodeId),
      ).toEqual([a]);
    });
  });

  it("traverses a five-level managed_by chain to the requested depth", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const chain: string[] = [];
      for (let i = 0; i < 6; i += 1) chain.push(await employee(tx, workspaceId));
      for (let i = 0; i < 5; i += 1) {
        await insertEdge(
          tx,
          workspaceId,
          edgeRecord("managed_by", chain[i]!, chain[i + 1]!),
        );
      }
      const three = await traverse(tx, workspaceId, chain[0]!, ["managed_by"], 3);
      expect(three.map((s) => [s.nodeId, s.depth])).toEqual([
        [chain[1], 1],
        [chain[2], 2],
        [chain[3], 3],
      ]);
      const all = await traverse(tx, workspaceId, chain[0]!, ["managed_by"], 10);
      expect(all.map((s) => s.depth)).toEqual([1, 2, 3, 4, 5]);
      expect(all.at(-1)!.nodeId).toBe(chain[5]);
      // A cycle back to the start is not followed twice.
      await insertEdge(tx, workspaceId, edgeRecord("managed_by", chain[5]!, chain[0]!));
      const cyclic = await traverse(tx, workspaceId, chain[0]!, ["managed_by"], 10);
      expect(cyclic).toHaveLength(5);
      await expect(
        traverse(tx, workspaceId, chain[0]!, ["managed_by"], 0),
      ).rejects.toBeInstanceOf(GraphValidationError);
    });
  });
});

describe("F204 — one User row per workspace", () => {
  it("stores one person as two User rows with the same node_id, one per workspace", async () => {
    const userId = randomUUID();
    await db.transaction(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const record = { ...nodeRecord("User", a, userId), node_id: userId };
      await writeMembershipUser(tx, a, record);
      await writeMembershipUser(tx, b, record);
      const rows = await tx
        .select()
        .from(graphNodes)
        .where(eq(graphNodes.nodeId, userId));
      expect(rows.map((r) => r.workspaceId).sort()).toEqual([a, b].sort());
      expect(rows.every((r) => !("workspace_id" in (r.record as object)))).toBe(true);
    });
  });

  it("rejects an edge from one workspace to a node in another", async () => {
    await db.transaction(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const inA = await employee(tx, a);
      const inB = await employee(tx, b);
      // The store looks endpoints up in the edge's own workspace...
      await expect(
        insertEdge(tx, a, edgeRecord("managed_by", inA, inB)),
      ).rejects.toBeInstanceOf(GraphValidationError);
    });
    // ...and the database refuses it even when the store is bypassed.
    const code = await pgCode(
      db.transaction(async (tx) => {
        const a = await newWorkspace(tx);
        const b = await newWorkspace(tx);
        const inA = await employee(tx, a);
        const inB = await employee(tx, b);
        const record = edgeRecord("managed_by", inA, inB);
        await tx.insert(graphEdges).values({
          edgeId: record.edge_id,
          workspaceId: a,
          edgeType: "managed_by",
          fromNodeId: inA,
          toNodeId: inB,
          createdAt: new Date(NOW),
          record,
        });
      }),
    );
    expect(code).toBe("23503");
  });

  it("rejects a non-User node whose node_id exists in another workspace", async () => {
    const nodeId = randomUUID();
    const code = await pgCode(
      db.transaction(async (tx) => {
        const a = await newWorkspace(tx);
        const b = await newWorkspace(tx);
        await insertNode(tx, nodeRecord("Employee", a, nodeId));
        await insertNode(tx, nodeRecord("Employee", b, nodeId));
      }),
    );
    expect(code).toBe("23505");
  });

  it("refuses a User write from any caller but the membership projection", async () => {
    await db.transaction(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const record = nodeRecord("User", workspaceId);
      await expect(insertNode(tx, record)).rejects.toBeInstanceOf(GraphValidationError);
      await expect(
        insertUserNode(tx, workspaceId, record, { kind: "membership-projection" }),
      ).rejects.toBeInstanceOf(GraphValidationError);
      await writeMembershipUser(tx, workspaceId, record);
      await expect(
        updateNodeFields(tx, workspaceId, record.node_id, null, {
          updated_at: NOW,
          updated_by: ACTOR,
        }),
      ).rejects.toBeInstanceOf(GraphValidationError);
      await expect(
        softDeleteNode(tx, workspaceId, record.node_id, { userId: ACTOR, at: NOW }),
      ).rejects.toBeInstanceOf(GraphValidationError);
    });
  });

  it("gives a Workspace node its own id as workspace_id and refuses any other", async () => {
    const code = await pgCode(
      db.transaction(async (tx) => {
        const id = randomUUID();
        await tx.insert(graphNodes).values({
          nodeId: id,
          workspaceId: randomUUID(),
          nodeType: "Workspace",
          lifecycleStatus: "Active",
          schemaVersion: 1,
          createdAt: new Date(NOW),
          record: { node_id: id, lifecycle_status: "Active" },
        });
      }),
    );
    expect(code).toBe("23514");
  });
});

describe("workspace.create — atomic across Better Auth and graph rows", () => {
  async function makeUser(): Promise<string> {
    const id = randomUUID();
    await db
      .insert(user)
      .values({ id, name: "Avery Stone", email: `${id}@example.test` });
    return id;
  }

  const admission = (
    userId: string,
    ids = { workspaceId: randomUUID(), membershipId: randomUUID() },
  ) => ({
    workspaceId: ids.workspaceId,
    workspaceName: "Northwind",
    workspaceSlug: `northwind-${ids.workspaceId}`,
    membershipId: ids.membershipId,
    userId,
    roles: ["owner"] as const,
  });

  async function graphCounts(workspaceId: string) {
    const [nodes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(graphNodes)
      .where(eq(graphNodes.workspaceId, workspaceId));
    const [edges] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(graphEdges)
      .where(eq(graphEdges.workspaceId, workspaceId));
    return { nodes: nodes!.n, edges: edges!.n };
  }

  async function centralRows(workspaceId: string, membershipId: string) {
    const rows = await db.execute(sql`
      select
        (select count(*)::int from organization where id = ${workspaceId}) as org,
        (select count(*)::int from member where id = ${membershipId}) as member`);
    return (rows as unknown as { org: number; member: number }[])[0]!;
  }

  it("writes the founding Entity and calendar atomically with the central membership row", async () => {
    const userId = await makeUser();
    const ids = { workspaceId: randomUUID(), membershipId: randomUUID() };
    await createPendingWorkspaceAdmission(admission(userId, ids));
    expect(await graphCounts(ids.workspaceId)).toEqual({ nodes: 5, edges: 3 });
    expect(await centralRows(ids.workspaceId, ids.membershipId)).toEqual({
      org: 1,
      member: 1,
    });
    const types = await db
      .select({ t: graphNodes.nodeType })
      .from(graphNodes)
      .where(eq(graphNodes.workspaceId, ids.workspaceId));
    expect(types.map((r) => r.t).sort()).toEqual([
      "Entity",
      "User",
      "WorkingCalendar",
      "Workspace",
      "WorkspaceMembership",
    ]);
  });

  it("rolls back the graph rows when the Better Auth insert fails", async () => {
    const ids = { workspaceId: randomUUID(), membershipId: randomUUID() };
    // No such account: the member insert fails after the graph rows are written.
    await expect(
      createPendingWorkspaceAdmission(admission(randomUUID(), ids)),
    ).rejects.toThrow();
    expect(await graphCounts(ids.workspaceId)).toEqual({ nodes: 0, edges: 0 });
    expect(await centralRows(ids.workspaceId, ids.membershipId)).toEqual({
      org: 0,
      member: 0,
    });
  });

  it("rolls back the Better Auth rows when a graph write fails", async () => {
    const userId = await makeUser();
    const first = { workspaceId: randomUUID(), membershipId: randomUUID() };
    await createPendingWorkspaceAdmission(admission(userId, first));
    // The membership id is already a graph node, so the graph insert fails.
    const second = { workspaceId: randomUUID(), membershipId: first.membershipId };
    await expect(
      createPendingWorkspaceAdmission(admission(userId, second)),
    ).rejects.toThrow();
    expect(await graphCounts(second.workspaceId)).toEqual({ nodes: 0, edges: 0 });
    expect(await centralRows(second.workspaceId, second.membershipId)).toEqual({
      org: 0,
      member: 1, // the first workspace's row, which shares this id
    });
  });

  it("gives one person two User rows for two workspaces", async () => {
    const userId = await makeUser();
    const w1 = randomUUID();
    const w2 = randomUUID();
    await createPendingWorkspaceAdmission(
      admission(userId, { workspaceId: w1, membershipId: randomUUID() }),
    );
    await createPendingWorkspaceAdmission(
      admission(userId, { workspaceId: w2, membershipId: randomUUID() }),
    );
    const rows = await db
      .select({ w: graphNodes.workspaceId })
      .from(graphNodes)
      .where(and(eq(graphNodes.nodeId, userId), eq(graphNodes.nodeType, "User")));
    expect(rows.map((r) => r.w).sort()).toEqual([w1, w2].sort());
  });
});
