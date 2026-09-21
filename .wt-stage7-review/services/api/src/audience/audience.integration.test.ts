import { randomUUID } from "node:crypto";
import {
  NODE_REGISTRY,
  getProtectionPartitions,
  resolvePermission,
  type NodeType,
  type PolicyRole,
} from "@vulto/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { member } from "../auth/schema.js";
import {
  revokeWorkspaceAdmission,
  admitWorkspaceMember,
} from "../auth/workspace-session.js";
import { closeDatabase, db } from "../db.js";
import { graphEdges, graphNodes } from "../graph/schema.js";
import { insertEdge, insertNode } from "../graph/store.js";
import { writeMembershipUser } from "../graph/membership-projection.js";
import type { GraphTx } from "../graph/tx.js";
import { decideRead, rowPartitionKey } from "../permission/interceptor.js";
import type { MemberPrincipal } from "../permission/principal.js";
import { resolveMemberPrincipal } from "../permission/member-principal.js";
import {
  edgeRecord,
  makeUser,
  makeWorkspace,
  nodeRecord,
} from "../permission/test-support.js";
import { applyMutation } from "../mutations/pipeline.js";
import { audienceMaterializer, isNodeTypeReplicable } from "./materializer.js";
import { syncEdgeAudience, syncNodeAudience } from "./schema.js";

afterAll(closeDatabase);

const READABLE = new Set(["full", "read"]);

/** One node of every registered type the store accepts, plus a few reporting lines. */
async function populate(workspaceId: string): Promise<Map<string, NodeType>> {
  const types = new Map<string, NodeType>();
  await db.transaction(async (tx) => {
    for (const { nodeType } of NODE_REGISTRY) {
      if (
        nodeType === "AuditEntry" ||
        nodeType === "Workspace" ||
        nodeType === "WorkspaceMembership"
      )
        continue;
      const record = nodeRecord(nodeType, workspaceId);
      if (nodeType === "User") await writeMembershipUser(tx, workspaceId, record);
      else await insertNode(tx, record);
      types.set(record.node_id, nodeType);
    }
    const employees = [...types]
      .filter(([, type]) => type === "Employee")
      .map(([id]) => id);
    const extra = [];
    for (let i = 0; i < 2; i += 1) {
      const record = nodeRecord("Employee", workspaceId);
      await insertNode(tx, record);
      extra.push(record.node_id);
      types.set(record.node_id, "Employee");
    }
    await insertEdge(
      tx,
      workspaceId,
      edgeRecord("managed_by", extra[0]!, employees[0]!),
    );
    await insertEdge(
      tx,
      workspaceId,
      edgeRecord("managed_by", extra[1]!, employees[0]!),
    );
  });
  return types;
}

/**
 * A003-T57: for a person, every audience row is one the interceptor permits, and
 * every Tier 0 row it permits is in the audience. Throws with the offending row.
 */
async function assertAudienceConforms(
  tx: GraphTx,
  workspaceId: string,
  principal: MemberPrincipal,
  oracleRole: PolicyRole | null,
): Promise<void> {
  const nodes = await tx
    .select()
    .from(graphNodes)
    .where(eq(graphNodes.workspaceId, workspaceId));
  const audience = new Set(
    (
      await tx
        .select({ id: syncNodeAudience.nodeId })
        .from(syncNodeAudience)
        .where(
          and(
            eq(syncNodeAudience.workspaceId, workspaceId),
            eq(syncNodeAudience.userId, principal.userId),
          ),
        )
    ).map((r) => r.id),
  );
  for (const node of nodes) {
    const nodeType = node.nodeType as NodeType;
    const partitionKey = rowPartitionKey(nodeType);
    const decision = await decideRead(tx, principal, {
      workspaceId,
      nodeType,
      nodeId: node.nodeId,
      partitionKey,
    });
    const permitted = READABLE.has(decision.access) && isNodeTypeReplicable(nodeType);
    const inAudience = audience.has(node.nodeId);
    if (inAudience && !permitted) {
      throw new Error(
        `audience holds ${nodeType} ${node.nodeId} that the interceptor does not permit`,
      );
    }
    if (permitted && !inAudience) {
      throw new Error(
        `interceptor permits ${nodeType} ${node.nodeId} but it is not in the audience`,
      );
    }
    if (oracleRole !== null) {
      // An independent oracle: the policy table itself, not the interceptor.
      const table = resolvePermission(oracleRole, nodeType, partitionKey).outcome;
      const expected = READABLE.has(table) && isNodeTypeReplicable(nodeType);
      if (inAudience !== expected) {
        throw new Error(
          `policy table disagrees for ${nodeType}: expected ${expected}, audience ${inAudience}`,
        );
      }
    }
    if (inAudience && getProtectionPartitions(nodeType).every((p) => p.tier !== 0)) {
      throw new Error(`audience holds ${nodeType}, which has no Tier 0 partition`);
    }
  }
}

async function principalOf(workspaceId: string, userId: string) {
  return (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, { userId, workspaceId }),
  ))!;
}

describe("A003-T57 — the sync audience equals what the interceptor permits", () => {
  it("holds for every role over a workspace with a node of every registered type", async () => {
    const fixture = await makeWorkspace({
      hr: ["hr-admin"],
      finance: ["finance-admin"],
      plain: ["team-member"],
    });
    await populate(fixture.workspaceId);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );

    const roles: Record<string, PolicyRole> = {
      owner: "owner",
      hr: "hr-admin",
      finance: "finance-admin",
      plain: "team-member",
    };
    for (const [name, role] of Object.entries(roles)) {
      const principal = await principalOf(
        fixture.workspaceId,
        fixture.people[name]!.userId,
      );
      await db.transaction((tx) =>
        assertAudienceConforms(tx, fixture.workspaceId, principal, role),
      );
    }
  });

  it("keeps a record a role may not read out of its audience, and protected-only types out of everyone's", async () => {
    const fixture = await makeWorkspace({
      hr: ["hr-admin"],
      finance: ["finance-admin"],
      plain: ["team-member"],
    });
    const types = await populate(fixture.workspaceId);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );
    const held = async (name: string) =>
      new Set(
        (
          await db
            .select({ id: syncNodeAudience.nodeId })
            .from(syncNodeAudience)
            .where(
              and(
                eq(syncNodeAudience.workspaceId, fixture.workspaceId),
                eq(syncNodeAudience.userId, fixture.people[name]!.userId),
              ),
            )
        ).map((r) => r.id),
      );
    const idOf = (type: NodeType) => [...types].find(([, t]) => t === type)![0];
    // A Tier 0 type only Owner and HR Admin may read, found from the policy table.
    const outcome = (role: PolicyRole, type: NodeType) =>
      resolvePermission(role, type, rowPartitionKey(type)).outcome;
    const restricted = [...new Set(types.values())].find(
      (type) =>
        isNodeTypeReplicable(type) &&
        READABLE.has(outcome("owner", type)) &&
        READABLE.has(outcome("hr-admin", type)) &&
        !READABLE.has(outcome("finance-admin", type)) &&
        !READABLE.has(outcome("team-member", type)),
    );
    expect(
      restricted,
      "the registry has a Tier 0 type only Owner and HR Admin read",
    ).toBeDefined();
    const target = idOf(restricted!);
    expect((await held("owner")).has(target)).toBe(true);
    expect((await held("hr")).has(target)).toBe(true);
    expect((await held("finance")).has(target)).toBe(false);
    expect((await held("plain")).has(target)).toBe(false);
    // HRCase has no Tier 0 partition, so it stays on the server for everyone.
    for (const name of ["owner", "hr", "finance", "plain"]) {
      expect((await held(name)).has(idOf("HRCase")), name).toBe(false);
    }
    // A record with no Tier 0 partition never replicates, not even to the Owner.
    const payRun = idOf("PayRun");
    for (const name of ["owner", "hr", "finance", "plain"])
      expect((await held(name)).has(payRun), name).toBe(false);
  });

  it("fails when the audience is wrong: a policy change that puts an HR-restricted node in a Team Member's audience", async () => {
    const fixture = await makeWorkspace({ plain: ["team-member"] });
    const types = await populate(fixture.workspaceId);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );
    const plain = await principalOf(fixture.workspaceId, fixture.people.plain!.userId);
    await db.transaction((tx) =>
      assertAudienceConforms(tx, fixture.workspaceId, plain, "team-member"),
    );

    const hrCase = [...types].find(([, t]) => t === "HRCase")![0];
    await db.insert(syncNodeAudience).values({
      workspaceId: fixture.workspaceId,
      userId: plain.userId,
      nodeId: hrCase,
    });
    await expect(
      db.transaction((tx) =>
        assertAudienceConforms(tx, fixture.workspaceId, plain, "team-member"),
      ),
    ).rejects.toThrow(/does not permit/);

    // And the reverse: a permitted row missing from the audience.
    await db
      .delete(syncNodeAudience)
      .where(eq(syncNodeAudience.userId, fixture.people.owner!.userId));
    const owner = await principalOf(fixture.workspaceId, fixture.people.owner!.userId);
    await expect(
      db.transaction((tx) =>
        assertAudienceConforms(tx, fixture.workspaceId, owner, "owner"),
      ),
    ).rejects.toThrow(/not in the audience/);
  });

  it("puts an edge in the audience only when both endpoints are, and only through a Tier 0 governing partition", async () => {
    const fixture = await makeWorkspace({
      plain: ["team-member"],
      finance: ["finance-admin"],
    });
    await populate(fixture.workspaceId);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );
    const edges = await db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.workspaceId, fixture.workspaceId));
    const managedBy = edges.filter((e) => e.edgeType === "managed_by");
    expect(managedBy.length).toBe(2);
    const edgeAudience = async (name: string) =>
      new Set(
        (
          await db
            .select({ id: syncEdgeAudience.edgeId })
            .from(syncEdgeAudience)
            .where(eq(syncEdgeAudience.userId, fixture.people[name]!.userId))
        ).map((r) => r.id),
      );
    for (const edge of managedBy) {
      expect((await edgeAudience("owner")).has(edge.edgeId)).toBe(true);
      expect((await edgeAudience("finance")).has(edge.edgeId)).toBe(true);
      expect((await edgeAudience("plain")).has(edge.edgeId)).toBe(false);
    }
    // Every edge held is between nodes the same person holds.
    for (const name of ["owner", "finance", "plain"]) {
      const held = await edgeAudience(name);
      const nodeIds = new Set(
        (
          await db
            .select({ id: syncNodeAudience.nodeId })
            .from(syncNodeAudience)
            .where(eq(syncNodeAudience.userId, fixture.people[name]!.userId))
        ).map((r) => r.id),
      );
      for (const edge of edges.filter((e) => held.has(e.edgeId))) {
        expect(
          nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId),
          `${name} ${edge.edgeType}`,
        ).toBe(true);
      }
    }
  });
});

describe("the audience follows every change, in the same transaction", () => {
  it("a mutation writes audience rows for the people who may read the new row", async () => {
    const fixture = await makeWorkspace({ hr: ["hr-admin"], plain: ["team-member"] });
    const owner = await principalOf(fixture.workspaceId, fixture.people.owner!.userId);
    const nodeId = randomUUID();
    const { workspace_id: _w, ...rest } = nodeRecord(
      "Entity",
      fixture.workspaceId,
      nodeId,
    );
    const result = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name: "graph.createNode",
      args: { node: { ...rest, workspace_id: fixture.workspaceId } },
    });
    expect(result.status).toBe("applied");
    const rows = await db
      .select()
      .from(syncNodeAudience)
      .where(eq(syncNodeAudience.nodeId, nodeId));
    const holders = rows.map((r) => r.userId).sort();
    expect(holders).toEqual(
      [fixture.people.owner!.userId, fixture.people.hr!.userId].sort(),
    );
  });

  it("admitting a member gives them their audience at once, and removing them takes it away", async () => {
    const fixture = await makeWorkspace();
    const userId = await makeUser();
    const membershipId = randomUUID();
    await admitWorkspaceMember({
      workspaceId: fixture.workspaceId,
      membershipId,
      userId,
      roles: ["hr-admin"],
      actorUserId: fixture.people.owner!.userId,
    });
    const count = async () =>
      (
        (await db.execute(
          sql`select count(*)::int as n from sync_node_audience where workspace_id = ${fixture.workspaceId} and user_id = ${userId}`,
        )) as unknown as { n: number }[]
      )[0]!.n;
    expect(await count()).toBeGreaterThan(0);
    await revokeWorkspaceAdmission(membershipId, fixture.people.owner!.userId);
    expect(await count()).toBe(0);
    const edges = (await db.execute(
      sql`select count(*)::int as n from sync_edge_audience where workspace_id = ${fixture.workspaceId} and user_id = ${userId}`,
    )) as unknown as { n: number }[];
    expect(edges[0]!.n).toBe(0);
  });

  it("a demoted member loses the rows the new role may not read on the next recompute", async () => {
    const fixture = await makeWorkspace({ person: ["hr-admin"] });
    await populate(fixture.workspaceId);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );
    const total = async () =>
      (
        (await db.execute(
          sql`select count(*)::int as n from sync_node_audience where user_id = ${fixture.people.person!.userId}`,
        )) as unknown as { n: number }[]
      )[0]!.n;
    const before = await total();
    expect(before).toBeGreaterThan(0);
    await db
      .update(member)
      .set({ role: "team-member" })
      .where(eq(member.userId, fixture.people.person!.userId));
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, fixture.workspaceId),
    );
    expect(await total()).toBeLessThan(before);
  });

  it("only the audience-recompute principal may recompute, by a row in the policy table", async () => {
    const { isSystemOperationPermitted } = await import("@vulto/schema");
    expect(isSystemOperationPermitted("audience-recompute", "audience.recompute")).toBe(
      true,
    );
    for (const name of ["retention-sweep", "erasure", "key-rotation"] as const) {
      expect(isSystemOperationPermitted(name, "audience.recompute")).toBe(false);
    }
  });
});

describe("A003-T58 — the publication is an allowlist, and Electric's role cannot write", () => {
  const PUBLISHED = [
    "graph_edges",
    "graph_nodes",
    "sync_edge_audience",
    "sync_node_audience",
  ];

  it("publishes exactly the four tables", async () => {
    const rows = (await db.execute(
      sql`select tablename from pg_publication_tables where pubname = 'electric_publication_default' order by tablename`,
    )) as unknown as { tablename: string }[];
    expect(rows.map((r) => r.tablename)).toEqual(PUBLISHED);
    const publications = (await db.execute(
      sql`select count(*)::int as n from pg_publication`,
    )) as unknown as { n: number }[];
    expect(publications[0]!.n).toBe(1);
  });

  it("gives the vulto_electric role SELECT on those four and nothing else, and no write anywhere", async () => {
    const privilege = async (table: string, kind: string) =>
      (
        (await db.execute(
          sql`select has_table_privilege('vulto_electric', ${`public.${table}`}, ${kind}) as ok`,
        )) as unknown as { ok: boolean }[]
      )[0]!.ok;
    for (const table of PUBLISHED) {
      expect(await privilege(table, "SELECT"), table).toBe(true);
      for (const kind of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect(await privilege(table, kind), `${table} ${kind}`).toBe(false);
      }
    }
    for (const table of [
      "member",
      "user",
      "session",
      "audit_journal",
      "graph_protected_fragments",
      "protected_data_keys",
      "graph_mutations",
      "device_unlock_secret",
    ]) {
      expect(await privilege(table, "SELECT"), table).toBe(false);
    }
    const role = (await db.execute(
      sql`select rolsuper, rolreplication, rolcanlogin, rolcreatedb, rolcreaterole from pg_roles where rolname = 'vulto_electric'`,
    )) as unknown as Record<string, boolean>[];
    expect(role[0]).toEqual({
      rolsuper: false,
      rolreplication: true,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it("holds identifiers only in the audience tables", async () => {
    const columns = (await db.execute(
      sql`select table_name, column_name from information_schema.columns where table_name in ('sync_node_audience','sync_edge_audience') order by table_name, column_name`,
    )) as unknown as { table_name: string; column_name: string }[];
    expect(columns.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "sync_edge_audience.edge_id",
      "sync_edge_audience.user_id",
      "sync_edge_audience.workspace_id",
      "sync_node_audience.node_id",
      "sync_node_audience.user_id",
      "sync_node_audience.workspace_id",
    ]);
  });
});
