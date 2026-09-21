import { ERASURE_DOMAIN_OVERRIDES, type NodeType } from "@vulto/schema";
import { outgoing } from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";

/**
 * The subject whose erasure must destroy a node's Tier 1 content (VPS-F007):
 * the Employee a salary or payslip concerns, the subject of a case, and
 * otherwise the node itself. `ERASURE_DOMAIN_OVERRIDES` is empty until a
 * feature registers one; no data key ever spans two domains (A003-T62).
 */
export async function resolveErasureDomain(
  tx: GraphTx,
  input: {
    readonly workspaceId: string;
    readonly nodeType: NodeType;
    readonly nodeId: string;
  },
): Promise<string> {
  const override = ERASURE_DOMAIN_OVERRIDES[input.nodeType];
  if (override === undefined) return input.nodeId;
  let current = input.nodeId;
  for (const edgeType of override.subjectPath) {
    const [edge] = await outgoing(tx, input.workspaceId, current, edgeType);
    if (!edge) return input.nodeId;
    current = edge.toNodeId;
  }
  return current;
}
