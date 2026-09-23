import type { SyncDatabase } from "../sync-client/database";
import { localEdges, localNodes } from "./cache-data";

export interface ProtectedContextualIntelligence {
  readonly burnoutAlert?: unknown;
  readonly flightRiskSignal?: unknown;
}

export async function getLocalContextualIntelligence(
  database: SyncDatabase,
  employeeId: string,
) {
  const nodes = await localNodes(database, ["Skill", "OpenRole", "GraphReference"]);
  const edges = await localEdges(database, [
    "has_skill",
    "requires_skill",
    "references",
    "referenced_in",
  ]);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const skillIds = new Set(
    edges
      .filter((edge) => edge.edgeType === "has_skill" && edge.fromNodeId === employeeId)
      .map((edge) => edge.toNodeId),
  );
  const openRoleIds = new Set(
    edges
      .filter(
        (edge) =>
          edge.edgeType === "requires_skill" &&
          byId.get(edge.fromNodeId)?.nodeType === "OpenRole" &&
          skillIds.has(edge.toNodeId),
      )
      .map((edge) => edge.fromNodeId),
  );
  const referenceIds = new Set(
    edges.flatMap((edge) => {
      if (edge.edgeType === "referenced_in" && edge.fromNodeId === employeeId)
        return [edge.toNodeId];
      if (edge.edgeType === "references" && edge.toNodeId === employeeId)
        return [edge.fromNodeId];
      return [];
    }),
  );
  return {
    skills: [...skillIds].flatMap((id) => (byId.has(id) ? [byId.get(id)!.record] : [])),
    openRoles: [...openRoleIds].flatMap((id) =>
      byId.has(id) ? [byId.get(id)!.record] : [],
    ),
    references: [...referenceIds].flatMap((id) =>
      byId.has(id) ? [byId.get(id)!.record] : [],
    ),
  };
}

/** The Panel's one public shape: local Tier 0 first, protected Tier 2 on demand. */
export async function getContextualIntelligence(
  database: SyncDatabase,
  employeeId: string,
  getProtected: (employeeId: string) => Promise<ProtectedContextualIntelligence>,
) {
  const [local, protectedFields] = await Promise.all([
    getLocalContextualIntelligence(database, employeeId),
    getProtected(employeeId),
  ]);
  return { ...local, ...protectedFields };
}
