import { randomUUID } from "node:crypto";
import {
  addIsoDays,
  proficiencyLevelSchema,
  skillGapFieldsSchema,
  skillGapSeverityFor,
  skillGapEvaluateDefinition,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
  type ProficiencyLevel,
} from "@vulto/schema";
import { audienceMaterializer } from "../audience/materializer.js";
import { db } from "../db.js";
import { resolveProjectCalendarEntity } from "../graph/entity-resolution.js";
import {
  getNode,
  getNodes,
  insertEdge,
  insertNode,
  outgoing,
  updateEdgeMetadata,
  updateNodeFields,
  type GraphTx,
} from "../graph/store.js";
import { ensureSystemActor } from "../graph/system-actor.js";
import { countWorkingDaysForEntity } from "../graph/working-days.js";
import { authorizeWrite } from "../permission/interceptor.js";
import { matchCandidates } from "../permission/skill-matcher-queries.js";
import type { SystemPrincipal } from "../permission/principal.js";
import { MutationRejection, type ServerMutation } from "./types.js";

const systemFor = (workspaceId: string): SystemPrincipal => ({
  kind: "system",
  name: "skill-gap-evaluate",
  workspaceId,
});

const levelOf = (edge: {
  record: Record<string, unknown>;
}): ProficiencyLevel | null => {
  const level = (edge.record["metadata"] as Record<string, unknown> | undefined)?.[
    "proficiency_level_required"
  ];
  const parsed = proficiencyLevelSchema.safeParse(level);
  return parsed.success ? parsed.data : null;
};

async function evaluateInTransaction(
  tx: GraphTx,
  workspaceId: string,
  projectId: string,
  skillId: string,
  now: string,
): Promise<string | null> {
  const project = await getNode(tx, workspaceId, projectId);
  if (!project || project.isSoftDeleted || project.nodeType !== "Project") return null;
  const requirement = (
    await outgoing(tx, workspaceId, projectId, "requires_skill", now)
  ).find((edge) => edge.toNodeId === skillId && edge.effectiveTo === null);
  if (!requirement) return null;
  const level = levelOf(requirement);
  if (!level) throw new Error("invalid-requirement-proficiency");
  const system = systemFor(workspaceId);
  const matches = await matchCandidates(tx, system, skillId, level, 30, now, {
    systemOperation: "skill-gap.read-cohort",
  });
  const active = (
    await getNodes(tx, workspaceId, {
      nodeType: "SkillGap",
      lifecycleStatus: "Active",
    })
  ).filter(
    (gap) =>
      gap.record["project_id"] === projectId && gap.record["skill_id"] === skillId,
  );
  if (active.length > 1) throw new Error("duplicate-active-skill-gap");
  const gap = active[0];
  if (matches.length > 0) {
    if (!gap) return null;
    const decision = await authorizeWrite(
      tx,
      system,
      {
        kind: "node",
        workspaceId,
        nodeType: "SkillGap",
        nodeId: gap.nodeId,
        partitionKey: "record",
      },
      { operation: "update" },
      { systemOperation: "skill-gap.write" },
    );
    if (!decision.allowed) throw new Error(`skill-gap-write-denied:${decision.reason}`);
    const actorId = await ensureSystemActor(tx, workspaceId, system.name, now);
    const patch = {
      lifecycle_status: "Resolved",
      resolved_at: now,
      resolved_by: "system",
      ...updateStamp("SkillGap", { workspaceId, userId: actorId, now }),
    };
    skillGapFieldsSchema.parse({ ...gap.record, ...patch });
    await updateNodeFields(tx, workspaceId, gap.nodeId, null, patch);
    await audienceMaterializer.onRowsChanged(tx, [gap.nodeId]);
    return gap.nodeId;
  }
  if (gap) return gap.nodeId;
  const startDate = project.record["start_date"];
  const today = now.slice(0, 10);
  let workingDays: number | null = null;
  if (typeof startDate === "string" && startDate > today) {
    const entity = await resolveProjectCalendarEntity(tx, workspaceId, projectId, now);
    if (entity) {
      workingDays = (
        await countWorkingDaysForEntity(
          tx,
          workspaceId,
          entity.nodeId,
          addIsoDays(today, 1),
          startDate,
          async () => true,
        )
      ).days;
    }
  } else if (typeof startDate === "string") {
    workingDays = 0;
  }
  const gapId = randomUUID();
  const edgeId = randomUUID();
  const decision = await authorizeWrite(
    tx,
    system,
    {
      kind: "node",
      workspaceId,
      nodeType: "SkillGap",
      nodeId: gapId,
      partitionKey: "record",
    },
    { operation: "create" },
    { systemOperation: "skill-gap.write" },
  );
  if (!decision.allowed) throw new Error(`skill-gap-write-denied:${decision.reason}`);
  const edgeDecision = await authorizeWrite(
    tx,
    system,
    {
      kind: "edge",
      workspaceId,
      edgeType: "gap_for",
      edgeId,
      fromNodeType: "SkillGap",
      fromNodeId: gapId,
      toNodeType: "Skill",
      toNodeId: skillId,
    },
    { operation: "create" },
    { systemOperation: "skill-gap.write" },
  );
  if (!edgeDecision.allowed)
    throw new Error(`skill-gap-edge-denied:${edgeDecision.reason}`);
  const actorId = await ensureSystemActor(tx, workspaceId, system.name, now);
  const provenance = { workspaceId, userId: actorId, now };
  const node = stampNewNode(
    {
      node_id: gapId,
      node_type: "SkillGap",
      schema_version: 1,
      lifecycle_status: "Active",
      skill_gap_id: gapId,
      project_id: projectId,
      skill_id: skillId,
      proficiency_level_required: level,
      identified_at: now,
      severity: skillGapSeverityFor(workingDays),
      resolved_at: null,
      resolved_by: null,
    },
    "SkillGap",
    provenance,
  );
  skillGapFieldsSchema.parse(node);
  await insertNode(tx, node);
  await insertEdge(
    tx,
    workspaceId,
    stampNewEdge(
      {
        edge_id: edgeId,
        edge_type: "gap_for",
        from_node_id: gapId,
        to_node_id: skillId,
        effective_from: now,
        effective_to: null,
      },
      provenance,
    ),
  );
  await audienceMaterializer.onRowsChanged(tx, [gapId, edgeId]);
  return gapId;
}

/** Internal reactive named mutation; no client router entry. */
export async function skillGapEvaluate(
  workspaceId: string,
  projectId: string,
  skillId: string,
  now = new Date().toISOString(),
) {
  skillGapEvaluateDefinition.input.parse({ project_id: projectId, skill_id: skillId });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(
        (tx) => evaluateInTransaction(tx, workspaceId, projectId, skillId, now),
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      if ((code !== "40001" && code !== "23505") || attempt === 4) throw error;
    }
  }
  throw new Error("unreachable");
}

export const projectAttachSkillRequirement: ServerMutation<
  MutationArgs<"project.attachSkillRequirement">
> = async (ctx) => {
  const {
    project_id: projectId,
    skill_id: skillId,
    proficiency_level_required: level,
  } = ctx.args;
  const workspaceId = ctx.principal.workspaceId;
  const project = await getNode(ctx.tx, workspaceId, projectId);
  const skill = await getNode(ctx.tx, workspaceId, skillId);
  if (
    !project ||
    project.isSoftDeleted ||
    project.nodeType !== "Project" ||
    !skill ||
    skill.isSoftDeleted ||
    skill.nodeType !== "Skill" ||
    skill.lifecycleStatus !== "Active"
  )
    throw new MutationRejection("invalid-args");
  const existing = (
    await outgoing(ctx.tx, workspaceId, projectId, "requires_skill", ctx.now)
  ).find((edge) => edge.toNodeId === skillId && edge.effectiveTo === null);
  const edgeId = existing?.edgeId ?? ctx.mutationId;
  return {
    checks: [
      {
        target: {
          kind: "edge",
          workspaceId,
          edgeType: "requires_skill",
          edgeId,
          fromNodeType: "Project",
          fromNodeId: projectId,
          toNodeType: "Skill",
          toNodeId: skillId,
        },
        change: { operation: existing ? "update" : "create" },
      },
    ],
    async validate() {},
    async apply() {
      const metadata = {
        ...(existing?.record["metadata"] as Record<string, unknown> | undefined),
        proficiency_level_required: level,
      };
      const edge = existing
        ? await updateEdgeMetadata(ctx.tx, workspaceId, edgeId, metadata, {
            userId: ctx.principal.userId,
            at: ctx.now,
          })
        : await insertEdge(
            ctx.tx,
            workspaceId,
            stampNewEdge(
              {
                edge_id: edgeId,
                edge_type: "requires_skill",
                from_node_id: projectId,
                to_node_id: skillId,
                effective_from: ctx.now,
                effective_to: null,
                metadata,
              },
              { workspaceId, userId: ctx.principal.userId, now: ctx.now },
            ),
          );
      return { result: { edge_id: edge.edgeId }, changedRowIds: [edge.edgeId] };
    },
    afterCommit: () =>
      skillGapEvaluate(workspaceId, projectId, skillId, ctx.now).then(() => {}),
  };
};
