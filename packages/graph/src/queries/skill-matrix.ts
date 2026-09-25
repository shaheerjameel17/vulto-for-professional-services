import {
  PROFICIENCY_LEVELS,
  proficiencyLevelSchema,
  proficiencyMeets,
  type ProficiencyLevel,
} from "@vulto/schema";
import type { SyncDatabase } from "../sync-client/database";
import { assignmentCoversDate } from "./bench-forecast";
import { localEdges, localNodes, type LocalEdge, type LocalNode } from "./cache-data";

export interface SkillMatrixFilters {
  readonly category?: string;
  readonly minProficiency?: ProficiencyLevel;
  readonly verifiedOnly?: boolean;
}

export interface SkillMatrixCell {
  readonly employeeId: string;
  readonly skillId: string;
  readonly proficiencyLevel: ProficiencyLevel;
  readonly verified: boolean;
  readonly certified: false;
}

const activeHolding = (edge: LocalEdge, now: string) =>
  edge.edgeType === "has_skill" &&
  edge.effectiveTo === null &&
  (edge.effectiveFrom === null || edge.effectiveFrom <= now);

const holdingCell = (edge: LocalEdge): SkillMatrixCell | null => {
  const metadata = edge.record["metadata"] as Record<string, unknown> | undefined;
  const parsed = proficiencyLevelSchema.safeParse(metadata?.["proficiency_level"]);
  if (!parsed.success) return null;
  return {
    employeeId: edge.fromNodeId,
    skillId: edge.toNodeId,
    proficiencyLevel: parsed.data,
    verified: metadata?.["verified"] === true,
    certified: false, // F296: VRS-F041 has not supplied a certification fact yet.
  };
};

const employeeName = (employee: LocalNode): string =>
  String(employee.record["full_name"] ?? employee.record["job_title"] ?? "");

/**
 * Category totals are a client-side reduction of the returned skills' coverage
 * and depth. A later UI must not create a separate server aggregation for them.
 */
export async function getSkillMatrix(
  database: SyncDatabase,
  filters: SkillMatrixFilters = {},
): Promise<{
  readonly employees: readonly { employeeId: string; isGhost: boolean; name: string }[];
  readonly skills: readonly {
    skillId: string;
    name: string;
    category: string | null;
    coverage: number;
    depth: number;
    isDeprecated: boolean;
  }[];
  readonly cells: readonly SkillMatrixCell[];
}> {
  const nodes = await localNodes(database, ["Employee", "Skill"]);
  const now = new Date().toISOString();
  // Read the registered certification edge for forward compatibility; F296
  // deliberately leaves certified false until VRS-F041 defines its semantics.
  const edges = await localEdges(database, ["has_skill", "holds_certification"]);
  const employees = nodes.filter(
    (node) => node.nodeType === "Employee" && node.lifecycleStatus === "Active",
  );
  const skills = nodes.filter(
    (node) =>
      node.nodeType === "Skill" &&
      (node.lifecycleStatus === "Active" || node.lifecycleStatus === "Deprecated") &&
      (filters.category === undefined || node.record["category"] === filters.category),
  );
  const employeeIds = new Set(employees.map((employee) => employee.nodeId));
  const skillIds = new Set(skills.map((skill) => skill.nodeId));
  const cells = edges
    .filter(
      (edge) =>
        activeHolding(edge, now) &&
        employeeIds.has(edge.fromNodeId) &&
        skillIds.has(edge.toNodeId),
    )
    .map(holdingCell)
    .filter((cell): cell is SkillMatrixCell => cell !== null)
    .filter(
      (cell) =>
        (filters.minProficiency === undefined ||
          proficiencyMeets(cell.proficiencyLevel, filters.minProficiency)) &&
        (!filters.verifiedOnly || cell.verified),
    );
  const cellsBySkill = new Map<string, SkillMatrixCell[]>();
  for (const cell of cells) {
    const group = cellsBySkill.get(cell.skillId) ?? [];
    group.push(cell);
    cellsBySkill.set(cell.skillId, group);
  }
  return {
    employees: employees.map((employee) => ({
      employeeId: employee.nodeId,
      isGhost: employee.record["employee_type"] === "Ghost",
      name: employeeName(employee),
    })),
    skills: skills.map((skill) => {
      const holders = cellsBySkill.get(skill.nodeId) ?? [];
      return {
        skillId: skill.nodeId,
        name: String(skill.record["name"]),
        category: (skill.record["category"] as string | null | undefined) ?? null,
        coverage: holders.length,
        depth: holders.filter((cell) =>
          proficiencyMeets(cell.proficiencyLevel, "Senior"),
        ).length,
        isDeprecated: skill.lifecycleStatus === "Deprecated",
      };
    }),
    cells,
  };
}

export async function getSkillHolders(
  database: SyncDatabase,
  skillId: string,
  now = new Date().toISOString(),
): Promise<{
  readonly holders: readonly {
    employeeId: string;
    proficiencyLevel: ProficiencyLevel;
    verified: boolean;
    certified: false;
    availabilityStatus: "Assigned" | "Available";
  }[];
}> {
  const nodes = await localNodes(database, ["Employee", "Skill", "Assignment"]);
  const edges = await localEdges(database, ["has_skill", "holds_certification"]);
  const skill = nodes.find(
    (node) =>
      node.nodeId === skillId &&
      node.nodeType === "Skill" &&
      (node.lifecycleStatus === "Active" || node.lifecycleStatus === "Deprecated"),
  );
  if (!skill) return { holders: [] };
  const employeeIds = new Set(
    nodes
      .filter(
        (node) => node.nodeType === "Employee" && node.lifecycleStatus === "Active",
      )
      .map((node) => node.nodeId),
  );
  const date = now.slice(0, 10);
  const coveredIds = new Set(
    nodes
      .filter((node) => assignmentCoversDate(node, date))
      .map((node) => String(node.record["employee_id"])),
  );
  const holders = edges
    .filter(
      (edge) =>
        activeHolding(edge, now) &&
        edge.toNodeId === skillId &&
        employeeIds.has(edge.fromNodeId),
    )
    .map(holdingCell)
    .filter((cell): cell is SkillMatrixCell => cell !== null)
    .map((cell) => ({
      employeeId: cell.employeeId,
      proficiencyLevel: cell.proficiencyLevel,
      verified: cell.verified,
      certified: cell.certified,
      availabilityStatus: coveredIds.has(cell.employeeId)
        ? ("Assigned" as const)
        : ("Available" as const),
    }))
    .sort(
      (a, b) =>
        PROFICIENCY_LEVELS.indexOf(b.proficiencyLevel) -
          PROFICIENCY_LEVELS.indexOf(a.proficiencyLevel) ||
        a.employeeId.localeCompare(b.employeeId),
    );
  return { holders };
}
