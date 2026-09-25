import {
  addIsoDays,
  PROFICIENCY_LEVELS,
  proficiencyMeets,
  type ProficiencyLevel,
} from "@vulto/schema";
import {
  getNode,
  getNodes,
  outgoing,
  type GraphTx,
  type StoredNode,
} from "../graph/store.js";
import { assignmentCovers, assignmentsFor } from "./bench-forecast-queries.js";
import {
  filterReadable,
  authorizeRead,
  type InterceptorContext,
} from "./interceptor.js";
import type { Principal, MemberPrincipal } from "./principal.js";

export interface SkillMatch {
  readonly employeeId: string;
  readonly isGhost: boolean;
  readonly availabilityDate: string | null;
  readonly proficiencyLevel: ProficiencyLevel;
  readonly verified: boolean;
  readonly certified: boolean;
}

const validLevel = (value: unknown): value is ProficiencyLevel =>
  typeof value === "string" && PROFICIENCY_LEVELS.includes(value as ProficiencyLevel);

/** The sole candidate traversal used by persistent, ad-hoc, and reactive paths. */
export async function matchCandidates(
  tx: GraphTx,
  principal: Principal,
  skillId: string,
  proficiencyRequired: ProficiencyLevel,
  availabilityWindowDays = 30,
  now = new Date().toISOString(),
  context: InterceptorContext = {},
): Promise<SkillMatch[]> {
  const workspaceId = principal.workspaceId;
  const employees = await filterReadable(
    tx,
    principal,
    await getNodes(tx, workspaceId, {
      nodeType: "Employee",
      lifecycleStatus: "Active",
    }),
    context,
  );
  const today = now.slice(0, 10);
  const windowEnd = addIsoDays(today, availabilityWindowDays);
  const matches: SkillMatch[] = [];
  for (const row of employees) {
    if ("restricted" in row || row.isSoftDeleted) continue;
    const holdings = await outgoing(tx, workspaceId, row.nodeId, "has_skill", now);
    const holding = holdings.find((edge) => edge.toNodeId === skillId);
    if (!holding) continue;
    const metadata = holding.record["metadata"] as Record<string, unknown> | undefined;
    const level = metadata?.["proficiency_level"];
    if (!validLevel(level) || !proficiencyMeets(level, proficiencyRequired)) continue;
    const isGhost = row.record["employee_type"] === "Ghost";
    let availabilityDate: string | null = null;
    if (isGhost) {
      const start = row.record["start_date"];
      availabilityDate = typeof start === "string" ? start : null;
    } else {
      const covering = (await assignmentsFor(tx, workspaceId, row.nodeId)).filter(
        (assignment) => assignmentCovers(assignment, today),
      );
      if (covering.length > 0) {
        const lastEnd = covering
          .map((assignment) => String(assignment.record["end_date"]))
          .sort()
          .at(-1)!;
        availabilityDate = addIsoDays(lastEnd, 1);
      }
    }
    if (availabilityDate !== null && availabilityDate > windowEnd) continue;
    matches.push({
      employeeId: row.nodeId,
      isGhost,
      availabilityDate,
      proficiencyLevel: level,
      verified: metadata?.["verified"] === true,
      certified: false,
    });
  }
  return matches.sort(
    (a, b) =>
      (a.availabilityDate ?? "").localeCompare(b.availabilityDate ?? "") ||
      PROFICIENCY_LEVELS.indexOf(b.proficiencyLevel) -
        PROFICIENCY_LEVELS.indexOf(a.proficiencyLevel) ||
      Number(a.isGhost) - Number(b.isGhost) ||
      a.employeeId.localeCompare(b.employeeId),
  );
}

export async function getMatchResults(
  tx: GraphTx,
  principal: MemberPrincipal,
  projectId: string,
  windowDays = 30,
  now = new Date().toISOString(),
) {
  const workspaceId = principal.workspaceId;
  const project = await getNode(tx, workspaceId, projectId);
  if (!project || project.isSoftDeleted || project.nodeType !== "Project") return null;
  const decision = await authorizeRead(tx, principal, {
    workspaceId,
    nodeType: "Project",
    nodeId: projectId,
  });
  if (decision.access !== "read" && decision.access !== "full") return null;
  const requirements = (
    await outgoing(tx, workspaceId, projectId, "requires_skill")
  ).filter((edge) => edge.effectiveTo === null);
  const gaps = (
    await filterReadable(
      tx,
      principal,
      await getNodes(tx, workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    )
  ).filter((row): row is StoredNode => !("restricted" in row));
  return {
    perRequirement: await Promise.all(
      requirements.map(async (edge) => {
        const level = (
          edge.record["metadata"] as Record<string, unknown> | undefined
        )?.["proficiency_level_required"];
        if (!validLevel(level)) return null;
        return {
          skillId: edge.toNodeId,
          proficiencyLevelRequired: level,
          matches: await matchCandidates(
            tx,
            principal,
            edge.toNodeId,
            level,
            windowDays,
            now,
          ),
          skillGapId:
            gaps.find(
              (gap) =>
                gap.record["project_id"] === projectId &&
                gap.record["skill_id"] === edge.toNodeId,
            )?.nodeId ?? null,
        };
      }),
    ).then((rows) => rows.filter((row) => row !== null)),
  };
}

export async function adHocSearch(
  tx: GraphTx,
  principal: MemberPrincipal,
  query: string,
  windowDays = 30,
  now = new Date().toISOString(),
) {
  const skills = (
    await filterReadable(
      tx,
      principal,
      await getNodes(tx, principal.workspaceId, {
        nodeType: "Skill",
        lifecycleStatus: "Active",
      }),
    )
  ).filter((row): row is StoredNode => !("restricted" in row));
  const selected = skills.filter((skill) =>
    String(skill.record["name"] ?? "")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const results = await Promise.all(
    selected.map(async (skill) => ({
      skillId: skill.nodeId,
      skillName: skill.record["name"],
      matches: await matchCandidates(
        tx,
        principal,
        skill.nodeId,
        "Beginner",
        windowDays,
        now,
      ),
    })),
  );
  return { results };
}

export async function listActiveSkillGaps(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
) {
  if (workspaceId !== principal.workspaceId) return [];
  const rows = (
    await filterReadable(
      tx,
      principal,
      await getNodes(tx, workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    )
  ).filter((row): row is StoredNode => !("restricted" in row));
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;
  const projects = new Map<string, StoredNode | null>();
  for (const row of rows) {
    const id = String(row.record["project_id"]);
    if (!projects.has(id)) projects.set(id, await getNode(tx, workspaceId, id));
  }
  return rows
    .sort(
      (a, b) =>
        (rank[a.record["severity"] as keyof typeof rank] ?? 4) -
          (rank[b.record["severity"] as keyof typeof rank] ?? 4) ||
        String(
          projects.get(String(a.record["project_id"]))?.record["start_date"] ?? "",
        ).localeCompare(
          String(
            projects.get(String(b.record["project_id"]))?.record["start_date"] ?? "",
          ),
        ),
    )
    .map((row) => ({ skillGapId: row.nodeId, record: row.record }));
}
