import type { GraphTx } from "./tx.js";
import {
  getNode,
  getNodes,
  outgoing,
  type StoredEdge,
  type StoredNode,
} from "./store.js";

export interface EntityAssignment {
  readonly entity: StoredNode;
  readonly edge: StoredEdge;
}

/** The one direct traversal of scoped_to_entity. All temporal readers use it. */
export async function resolveEntityAssignment(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  at: string | "open",
): Promise<EntityAssignment | null> {
  const employee = await getNode(tx, workspaceId, employeeId);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    return null;
  const edges = await outgoing(
    tx,
    workspaceId,
    employeeId,
    "scoped_to_entity",
    at === "open" ? undefined : at,
  );
  const edge =
    at === "open"
      ? edges.find((candidate) => candidate.effectiveTo === null)
      : edges[0];
  if (!edge) return null;
  const entity = await getNode(tx, workspaceId, edge.toNodeId);
  if (!entity || entity.nodeType !== "Entity") return null;
  return { entity, edge };
}

/** The server's single entity-in-force answer; asOf is inclusive and defaults to now. */
export async function resolveForEmployee(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  asOf = new Date().toISOString(),
): Promise<StoredNode | null> {
  return (
    (await resolveEntityAssignment(tx, workspaceId, employeeId, asOf))?.entity ?? null
  );
}

/** G05's count uses the same temporal answer as every consuming feature. */
export async function countActiveEmployeesForEntity(
  tx: GraphTx,
  workspaceId: string,
  entityId: string,
  asOf: string,
): Promise<number> {
  const employees = await getNodes(tx, workspaceId, {
    nodeType: "Employee",
    lifecycleStatus: "Active",
  });
  let count = 0;
  for (const employee of employees) {
    const entity = await resolveForEmployee(tx, workspaceId, employee.nodeId, asOf);
    if (entity?.nodeId === entityId) count += 1;
  }
  return count;
}
