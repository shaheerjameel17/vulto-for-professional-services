import { getKeyServices } from "../crypto/keys.js";
import { getNodes, type GraphTx } from "../graph/store.js";
import { readProtected } from "../protected/read.js";
import { filterReadable, type InterceptorContext } from "./interceptor.js";
import type { MemberPrincipal } from "./principal.js";
import type { AnomalyFlagRecord } from "../mutations/timesheet-anomaly.js";

/** The interceptor filters Tier 2 nodes before any protected content is released. */
export async function listActiveAnomalies(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
  context: InterceptorContext = {},
) {
  if (workspaceId !== principal.workspaceId) return [];
  const rows = await filterReadable(
    tx,
    principal,
    await getNodes(tx, workspaceId, { nodeType: "TimesheetAnomalyFlag" }),
    context,
  );
  const items = await readProtected(
    tx,
    getKeyServices(),
    principal,
    { nodeIds: rows.map((row) => row.nodeId), partitions: ["record"] },
    context,
  );
  return items.flatMap((item) => {
    if (item.state !== "available") return [];
    const record = item.value as AnomalyFlagRecord;
    return record.cleared_at === null ? [{ flagId: item.node_id, ...record }] : [];
  });
}
