import { getNode, outgoing, type GraphTx } from "../graph/store.js";
import { authorizeRead, type InterceptorContext } from "./interceptor.js";
import type { Principal } from "./principal.js";

export interface StaffedPitchSummary {
  readonly pitchId: string;
  readonly name: string;
  readonly clientName: string | null;
}

/** The selector's sole path to Pitch. The Employee read is its access gate. */
export async function listStaffedFor(
  tx: GraphTx,
  principal: Principal,
  employeeId: string,
  context: InterceptorContext = {},
): Promise<StaffedPitchSummary[]> {
  const employee = await getNode(tx, principal.workspaceId, employeeId);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    return [];
  const decision = await authorizeRead(
    tx,
    principal,
    {
      workspaceId: principal.workspaceId,
      nodeType: "Employee",
      nodeId: employeeId,
      partitionKey: "operational",
    },
    context,
  );
  if (decision.access !== "read" && decision.access !== "full") return [];

  const edges = await outgoing(tx, principal.workspaceId, employeeId, "staffed_on");
  const result: StaffedPitchSummary[] = [];
  for (const edge of edges) {
    if (edge.effectiveTo !== null) continue;
    const pitch = await getNode(tx, principal.workspaceId, edge.toNodeId);
    if (!pitch || pitch.isSoftDeleted || pitch.nodeType !== "Pitch") continue;
    const name = pitch.record["name"];
    if (typeof name !== "string") continue;
    const clientId = pitch.record["client_id"];
    const client =
      typeof clientId === "string"
        ? await getNode(tx, principal.workspaceId, clientId)
        : null;
    const clientName =
      client &&
      !client.isSoftDeleted &&
      client.nodeType === "Client" &&
      typeof client.record["name"] === "string"
        ? client.record["name"]
        : null;
    result.push({ pitchId: pitch.nodeId, name, clientName });
  }
  return result.sort(
    (a, b) => a.name.localeCompare(b.name) || a.pitchId.localeCompare(b.pitchId),
  );
}
