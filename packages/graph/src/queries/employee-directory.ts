import { operationalShape, type EMPLOYMENT_TYPES } from "@vulto/schema";
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
import type { SyncDatabase } from "../sync-client/database";
import { localEdges, localNodes, type LocalNode } from "./cache-data";
import { activeHolding, holdingCell } from "./skill-matrix";

export interface DirectoryEmployee {
  readonly employeeId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly operational: Record<string, unknown>;
  readonly entityId: string | null;
  readonly entityName: string | null;
  readonly managerId: string | null;
  readonly managerName: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const active = (
  edge: { effectiveFrom: string | null; effectiveTo: string | null },
  now: string,
) =>
  (edge.effectiveFrom === null || edge.effectiveFrom <= now) &&
  (edge.effectiveTo === null || edge.effectiveTo > now);

/** Only operational fields cross this boundary, even if a malformed cache row holds more. */
export async function listEmployeesForDirectory(
  database: SyncDatabase,
): Promise<DirectoryEmployee[]> {
  const nodes = await localNodes(database, ["Employee", "Entity"]);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const now = new Date().toISOString();
  const edges = (await localEdges(database, ["scoped_to_entity", "managed_by"])).filter(
    (edge) => active(edge, now),
  );
  return nodes
    .filter((node) => node.nodeType === "Employee")
    .map((node) => {
      const managerId =
        edges.find(
          (edge) => edge.edgeType === "managed_by" && edge.fromNodeId === node.nodeId,
        )?.toNodeId ?? null;
      const entityId =
        edges.find(
          (edge) =>
            edge.edgeType === "scoped_to_entity" && edge.fromNodeId === node.nodeId,
        )?.toNodeId ?? null;
      const operational = Object.fromEntries(
        [...Object.keys(operationalShape), "employee_code"]
          .filter((key) => key in node.record)
          .map((key) => [key, node.record[key]]),
      );
      return {
        employeeId: node.nodeId,
        lifecycleStatus: node.lifecycleStatus,
        version: node.version,
        operational,
        entityId,
        entityName: text(entityId ? byId.get(entityId)?.record["name"] : null),
        managerId,
        managerName: text(managerId ? byId.get(managerId)?.record["full_name"] : null),
      };
    });
}

/** A single-node lookup stays private; there is no general new query kind. */
const localNode = (nodes: readonly LocalNode[], id: string) =>
  nodes.find((node) => node.nodeId === id);

export async function getEmployeeForProfile(
  database: SyncDatabase,
  employeeId: string,
) {
  const employee = (await listEmployeesForDirectory(database)).find(
    (row) => row.employeeId === employeeId,
  );
  if (!employee) return null;
  const skills = await localNodes(database, ["Skill"]);
  const now = new Date().toISOString();
  const holdings = (await localEdges(database, ["has_skill"]))
    .filter((edge) => edge.fromNodeId === employeeId && activeHolding(edge, now))
    .map(holdingCell)
    .filter((cell) => cell !== null)
    .flatMap((cell) => {
      const skill = localNode(skills, cell.skillId);
      return skill
        ? [
            {
              skillId: cell.skillId,
              name: String(skill.record["name"] ?? ""),
              proficiency: cell.proficiencyLevel,
              verified: cell.verified,
            },
          ]
        : [];
    });
  // F354–F356: no certification, document or business-event source exists yet.
  return {
    ...employee,
    skills: holdings,
    certifications: [],
    documents: [],
    activity: [],
  };
}
