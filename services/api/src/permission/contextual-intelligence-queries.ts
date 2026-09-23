import type { KeyServices } from "../crypto/keys.js";
import { getNode, incoming, type GraphTx } from "../graph/store.js";
import { readProtected } from "../protected/read.js";
import { authorizeRead, type InterceptorContext } from "./interceptor.js";
import type { Principal } from "./principal.js";

export async function getProtectedContextualIntelligence(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  employeeId: string,
  context: InterceptorContext = {},
) {
  const employee = await getNode(tx, principal.workspaceId, employeeId);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    return {};
  const employeeDecision = await authorizeRead(
    tx,
    principal,
    { workspaceId: principal.workspaceId, nodeType: "Employee", nodeId: employeeId },
    context,
  );
  if (employeeDecision.access !== "read" && employeeDecision.access !== "full")
    return {};
  const alertNodes = [];
  for (const edge of await incoming(
    tx,
    principal.workspaceId,
    employeeId,
    "triggered_by",
  )) {
    const node = await getNode(tx, principal.workspaceId, edge.fromNodeId);
    if (
      node &&
      !node.isSoftDeleted &&
      (node.nodeType === "BurnoutAlert" || node.nodeType === "FlightRiskSignal")
    ) {
      alertNodes.push(node);
    }
  }
  const values = await readProtected(
    tx,
    services,
    principal,
    { nodeIds: alertNodes.map(({ nodeId }) => nodeId) },
    context,
  );
  const available = new Map(
    values.flatMap((item) =>
      item.state === "available" ? [[item.node_id, item.value] as const] : [],
    ),
  );
  const result: { burnoutAlert?: unknown; flightRiskSignal?: unknown } = {};
  for (const node of alertNodes) {
    const value = available.get(node.nodeId);
    if (value === undefined) continue;
    if (node.nodeType === "BurnoutAlert") result.burnoutAlert = value;
    if (node.nodeType === "FlightRiskSignal") result.flightRiskSignal = value;
  }
  return result;
}
