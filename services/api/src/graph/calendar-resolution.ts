import {
  getNode,
  outgoing,
  type GraphTx,
  type StoredEdge,
  type StoredNode,
} from "./store.js";

/** G01: resolves the one calendar version in force, following new -> prior supersedes edges. */
export async function resolveCalendarForEntity(
  tx: GraphTx,
  workspaceId: string,
  entityId: string,
  asOf?: string,
): Promise<StoredNode | null> {
  const ownership = await outgoing(tx, workspaceId, entityId, "governed_by_calendar");
  const calendars: StoredNode[] = [];
  for (const edge of ownership) {
    const node = await getNode(tx, workspaceId, edge.toNodeId);
    if (node && !node.isSoftDeleted && node.nodeType === "WorkingCalendar")
      calendars.push(node);
  }
  let current =
    calendars.find((calendar) => calendar.lifecycleStatus === "Active") ?? null;
  if (!current || asOf === undefined) return current;
  const instant = Date.parse(`${asOf}T23:59:59.999Z`);
  const seen = new Set<string>();
  while (current && !seen.has(current.nodeId)) {
    seen.add(current.nodeId);
    const createdAt = Date.parse(String(current.record["created_at"]));
    if (createdAt <= instant) return current;
    const priorEdge: StoredEdge | undefined = (
      await outgoing(tx, workspaceId, current.nodeId, "supersedes")
    )[0];
    current = priorEdge ? await getNode(tx, workspaceId, priorEdge.toNodeId) : null;
  }
  return null;
}
