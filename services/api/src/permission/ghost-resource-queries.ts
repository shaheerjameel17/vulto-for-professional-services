import type { NodeType } from "@vulto/schema";
import { getNodes, type GraphTx, type StoredNode } from "../graph/store.js";
import { filterReadable, type InterceptorContext } from "./interceptor.js";
import type { Principal } from "./principal.js";

export interface GhostResourceSummary {
  readonly ghostId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly record: Readonly<Record<string, unknown>>;
}

export async function listGhostResources(
  tx: GraphTx,
  principal: Principal,
  filter: { readonly lifecycleStatus?: string } = {},
  context: InterceptorContext = {},
): Promise<GhostResourceSummary[]> {
  const rows = await getNodes(tx, principal.workspaceId, {
    nodeType: "GhostResource" as NodeType,
    ...(filter.lifecycleStatus === undefined
      ? {}
      : { lifecycleStatus: filter.lifecycleStatus }),
  });
  const readable = await filterReadable(tx, principal, rows, context);
  return readable
    .map((row) => {
      const stored = row as StoredNode;
      return {
        ghostId: stored.nodeId,
        lifecycleStatus: stored.lifecycleStatus,
        version: stored.version,
        record: stored.record,
      };
    })
    .sort((a, b) => a.ghostId.localeCompare(b.ghostId));
}
