import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { member } from "../auth/schema.js";
import { admitWorkspaceMember } from "../auth/workspace-session.js";
import { closeDatabase, db } from "../db.js";
import { makeUser, makeWorkspace } from "../permission/test-support.js";
import { graphEdges, graphNodes } from "./schema.js";

afterAll(closeDatabase);

const graphRowsFor = async (membershipId: string, workspaceId: string) => ({
  nodes: await db
    .select({ type: graphNodes.nodeType })
    .from(graphNodes)
    .where(
      and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.nodeId, membershipId)),
    ),
  edges: await db
    .select({ type: graphEdges.edgeType })
    .from(graphEdges)
    .where(eq(graphEdges.fromNodeId, membershipId)),
});

describe("invitation acceptance writes the graph with the membership row", () => {
  it("admits a member: the central row and the graph records commit together", async () => {
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
    const [row] = await db.select().from(member).where(eq(member.id, membershipId));
    expect(row).toMatchObject({
      status: "active",
      projectionState: "confirmed",
      role: "hr-admin",
    });
    const graph = await graphRowsFor(membershipId, fixture.workspaceId);
    expect(graph.nodes.map((n) => n.type)).toEqual(["WorkspaceMembership"]);
    expect(graph.edges.map((e) => e.type).sort()).toEqual([
      "membership_in",
      "membership_of",
    ]);
    const users = await db
      .select({ w: graphNodes.workspaceId })
      .from(graphNodes)
      .where(and(eq(graphNodes.nodeId, userId), eq(graphNodes.nodeType, "User")));
    expect(users.map((u) => u.w)).toEqual([fixture.workspaceId]);
  });

  it("stores the same person once per workspace they join", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    const userId = await makeUser();
    for (const fixture of [a, b]) {
      await admitWorkspaceMember({
        workspaceId: fixture.workspaceId,
        membershipId: randomUUID(),
        userId,
        roles: ["team-member"],
        actorUserId: fixture.people.owner!.userId,
      });
    }
    const users = await db
      .select({ w: graphNodes.workspaceId })
      .from(graphNodes)
      .where(and(eq(graphNodes.nodeId, userId), eq(graphNodes.nodeType, "User")));
    expect(users.map((u) => u.w).sort()).toEqual([a.workspaceId, b.workspaceId].sort());
  });

  it("rolls everything back when either side fails", async () => {
    const fixture = await makeWorkspace();
    const userId = await makeUser();
    const membershipId = randomUUID();
    const input = {
      workspaceId: fixture.workspaceId,
      membershipId,
      userId,
      roles: ["team-member"] as const,
      actorUserId: fixture.people.owner!.userId,
    };
    await admitWorkspaceMember(input);
    // The same membership id again: the graph write fails, so no second central row appears.
    const other = await makeUser();
    await expect(admitWorkspaceMember({ ...input, userId: other })).rejects.toThrow();
    const rows = await db.select().from(member).where(eq(member.id, membershipId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    // A central failure (no such account) leaves no graph rows behind.
    const orphanMembership = randomUUID();
    await expect(
      admitWorkspaceMember({
        ...input,
        membershipId: orphanMembership,
        userId: randomUUID(),
      }),
    ).rejects.toThrow();
    const graph = await graphRowsFor(orphanMembership, fixture.workspaceId);
    expect(graph).toEqual({ nodes: [], edges: [] });
  });
});
