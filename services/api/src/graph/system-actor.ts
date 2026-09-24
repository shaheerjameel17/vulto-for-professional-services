import { nodeRecordSchema, type SystemPrincipalName } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { deterministicUuid } from "../auth/membership-edge-ids.js";
import { graphNodes } from "./schema.js";
import type { GraphTx } from "./tx.js";

/** A reserved, non-member User identity for one system principal in a workspace. */
export const systemActorId = (workspaceId: string, name: SystemPrincipalName): string =>
  deterministicUuid(`system_actor:${workspaceId}:${name}`);

/** F272: idempotent, race-safe provenance provisioning in the writer's transaction. */
export async function ensureSystemActor(
  tx: GraphTx,
  workspaceId: string,
  name: SystemPrincipalName,
  now: string,
): Promise<string> {
  const nodeId = systemActorId(workspaceId, name);
  const record = nodeRecordSchema.parse({
    node_id: nodeId,
    node_type: "User",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: now,
    created_by: nodeId,
    updated_at: now,
    updated_by: nodeId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  });
  await tx
    .insert(graphNodes)
    .values({
      workspaceId,
      nodeId,
      nodeType: "User",
      schemaVersion: 1,
      lifecycleStatus: "Active",
      isSoftDeleted: false,
      createdAt: new Date(now),
      createdBy: nodeId,
      updatedAt: new Date(now),
      updatedBy: nodeId,
      record,
    })
    .onConflictDoNothing({ target: [graphNodes.workspaceId, graphNodes.nodeId] });
  const [stored] = await tx
    .select({ nodeType: graphNodes.nodeType, isSoftDeleted: graphNodes.isSoftDeleted })
    .from(graphNodes)
    .where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.nodeId, nodeId)));
  if (!stored || stored.nodeType !== "User" || stored.isSoftDeleted) {
    throw new Error("Reserved system actor identity is unavailable");
  }
  return nodeId;
}
