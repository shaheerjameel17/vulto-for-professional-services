import { randomUUID } from "node:crypto";
import { NODE_REGISTRY, type WorkspaceRole } from "@vulto/schema";
import { user } from "../auth/schema.js";
import {
  admitWorkspaceMember,
  createPendingWorkspaceAdmission,
  confirmWorkspaceAdmission,
} from "../auth/workspace-session.js";
import { db } from "../db.js";
import type { GraphTx } from "../graph/tx.js";
import { insertNode } from "../graph/store.js";

/** Test fixtures shared by the permission and audit suites. Not imported by production code. */

export const NOW = "2026-09-21T09:00:00.000Z";

export async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db
    .insert(user)
    .values({ id, name: "Test Person", email: `${id}@example.test` });
  return id;
}

export interface Fixture {
  readonly workspaceId: string;
  readonly people: Record<string, { userId: string; membershipId: string }>;
}

/** A workspace whose founder is the Owner, plus one person per named role set. */
export async function makeWorkspace(
  others: Record<string, readonly WorkspaceRole[]> = {},
): Promise<Fixture> {
  const workspaceId = randomUUID();
  const ownerId = await makeUser();
  const ownerMembership = randomUUID();
  await createPendingWorkspaceAdmission({
    workspaceId,
    workspaceName: "Fixture",
    workspaceSlug: `fixture-${workspaceId}`,
    membershipId: ownerMembership,
    userId: ownerId,
    roles: ["owner"],
  });
  await confirmWorkspaceAdmission(ownerMembership);
  const people: Fixture["people"] = {
    owner: { userId: ownerId, membershipId: ownerMembership },
  };
  for (const [name, roles] of Object.entries(others)) {
    const userId = await makeUser();
    const membershipId = randomUUID();
    await admitWorkspaceMember({
      workspaceId,
      membershipId,
      userId,
      roles,
      actorUserId: ownerId,
    });
    people[name] = { userId, membershipId };
  }
  return { workspaceId, people };
}

export function nodeRecord(
  nodeType: string,
  workspaceId: string,
  nodeId = randomUUID(),
) {
  const registration = NODE_REGISTRY.find((r) => r.nodeType === nodeType)!;
  const lifecycle =
    registration.lifecycle.kind === "fixed"
      ? registration.lifecycle.statuses[0]
      : "Active";
  const actor = randomUUID();
  const scoped = nodeType !== "Workspace" && nodeType !== "User";
  return {
    node_id: nodeId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: lifecycle,
    ...(scoped ? { workspace_id: workspaceId } : {}),
    created_at: NOW,
    created_by: actor,
    updated_at: NOW,
    updated_by: actor,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

export function edgeRecord(
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
    created_by: randomUUID(),
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

export async function addNode(
  tx: GraphTx,
  workspaceId: string,
  nodeType: string,
): Promise<string> {
  const record = nodeRecord(nodeType, workspaceId);
  await insertNode(tx, record);
  return record.node_id;
}
