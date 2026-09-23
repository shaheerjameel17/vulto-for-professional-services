import {
  ghostEmployeeOperationalRecord,
  ghostResourceTransition,
  mutationDerivedId,
  normalizeEmployeeEmail,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
  type NodeType,
} from "@vulto/schema";
import {
  closeEdge,
  getNode,
  insertEdge,
  insertNode,
  outgoing,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import { requireUnique } from "./employee.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
  type WriteCheck,
} from "./types.js";

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

const nodeTarget = (
  ctx: MutationContext<unknown>,
  nodeType: "GhostResource" | "Employee",
  nodeId: string,
) => ({
  kind: "node" as const,
  workspaceId: ctx.principal.workspaceId,
  nodeType,
  nodeId,
  ...(nodeType === "Employee" ? { partitionKey: "operational" } : {}),
});

const edgeTarget = (
  ctx: MutationContext<unknown>,
  edgeType: "has_skill" | "placeholder_for" | "promoted_to",
  fromNodeType: "Employee" | "GhostResource",
  toNodeType: "Skill" | "OpenRole" | "Employee",
  edgeId: string,
) => ({
  kind: "edge" as const,
  workspaceId: ctx.principal.workspaceId,
  edgeType,
  fromNodeType,
  toNodeType,
  edgeId,
});

async function requireNode(
  ctx: MutationContext<unknown>,
  id: string,
  type: NodeType,
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== type) throw new MutationRejection("invalid-args");
  return node;
}

const newEdge = (
  ctx: MutationContext<unknown>,
  input: {
    edgeId: string;
    edgeType: string;
    fromNodeId: string;
    toNodeId: string;
  },
) =>
  stampNewEdge(
    {
      edge_id: input.edgeId,
      edge_type: input.edgeType,
      from_node_id: input.fromNodeId,
      to_node_id: input.toNodeId,
      effective_from: ctx.now,
      effective_to: null,
    },
    provenance(ctx),
  );

export const ghostResourceCreate: ServerMutation<
  MutationArgs<"ghostResource.create">
> = async (ctx) => {
  const ghostId = ctx.mutationId;
  const employeeId = mutationDerivedId(ctx.mutationId, 1);
  const openRoleEdgeId = mutationDerivedId(ctx.mutationId, 2);
  const skillIds = [...new Set(ctx.args.target_skill_ids ?? [])];
  const skills = await Promise.all(
    skillIds.map((skillId) => requireNode(ctx, skillId, "Skill")),
  );
  const openRole = ctx.args.open_role_id
    ? await requireNode(ctx, ctx.args.open_role_id, "OpenRole")
    : null;
  const checks: WriteCheck[] = [
    {
      target: nodeTarget(ctx, "Employee", employeeId),
      change: { operation: "create" },
    },
    {
      target: nodeTarget(ctx, "GhostResource", ghostId),
      change: { operation: "create" },
    },
    ...skills.map((skill, index) => ({
      target: edgeTarget(
        ctx,
        "has_skill",
        "Employee",
        "Skill",
        mutationDerivedId(ctx.mutationId, 10 + index),
      ),
      change: { operation: "create" as const },
    })),
    ...(openRole
      ? [
          {
            target: edgeTarget(
              ctx,
              "placeholder_for",
              "GhostResource",
              "OpenRole",
              openRoleEdgeId,
            ),
            change: { operation: "create" as const },
          },
        ]
      : []),
  ];
  return {
    checks,
    async validate() {},
    async apply() {
      await insertNode(
        ctx.tx,
        stampNewNode(
          {
            node_id: employeeId,
            node_type: "Employee",
            schema_version: 1,
            lifecycle_status: "Active",
            ...ghostEmployeeOperationalRecord({
              job_title: ctx.args.role_title,
              start_date: ctx.args.projected_start_date,
              ...(ctx.args.seniority_level === undefined
                ? {}
                : { seniority_level: ctx.args.seniority_level }),
              ...(ctx.args.expected_rate === undefined
                ? {}
                : { billing_rate_default: ctx.args.expected_rate }),
            }),
          },
          "Employee",
          provenance(ctx),
        ),
      );
      await insertNode(
        ctx.tx,
        stampNewNode(
          {
            node_id: ghostId,
            node_type: "GhostResource",
            schema_version: 1,
            lifecycle_status: "Active",
            ghost_employee_id: employeeId,
            notes: null,
          },
          "GhostResource",
          provenance(ctx),
        ),
      );
      const changed = [employeeId, ghostId];
      for (const [index, skill] of skills.entries()) {
        const edgeId = mutationDerivedId(ctx.mutationId, 10 + index);
        await insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          newEdge(ctx, {
            edgeId,
            edgeType: "has_skill",
            fromNodeId: employeeId,
            toNodeId: skill.nodeId,
          }),
        );
        changed.push(edgeId);
      }
      if (openRole) {
        await insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          newEdge(ctx, {
            edgeId: openRoleEdgeId,
            edgeType: "placeholder_for",
            fromNodeId: ghostId,
            toNodeId: openRole.nodeId,
          }),
        );
        changed.push(openRoleEdgeId);
      }
      return { result: { ghostId, employeeId }, changedRowIds: changed };
    },
  };
};

export const ghostResourceCancel: ServerMutation<
  MutationArgs<"ghostResource.cancel">
> = async (ctx) => {
  const ghost = await requireNode(ctx, ctx.args.ghost_id, "GhostResource");
  return {
    checks: [
      {
        target: nodeTarget(ctx, "GhostResource", ghost.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (ctx.args.expected_version !== ghost.version)
        throw new MutationRejection("stale-state");
      if (!ghostResourceTransition(ghost.lifecycleStatus, "Canceled"))
        throw new MutationRejection("invalid-transition");
    },
    async apply() {
      const updated = await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        ghost.nodeId,
        ctx.args.expected_version,
        {
          lifecycle_status: "Canceled",
          ...updateStamp("GhostResource", provenance(ctx)),
        },
      );
      return { result: { success: true }, changedRowIds: [updated.nodeId] };
    },
  };
};

export const ghostResourceLinkOpenRole: ServerMutation<
  MutationArgs<"ghostResource.linkOpenRole">
> = async (ctx) => {
  const ghost = await requireNode(ctx, ctx.args.ghost_id, "GhostResource");
  const openRole = await requireNode(ctx, ctx.args.open_role_id, "OpenRole");
  const current = (
    await outgoing(ctx.tx, ctx.principal.workspaceId, ghost.nodeId, "placeholder_for")
  ).find((edge) => !edge.isSoftDeleted && edge.effectiveTo === null);
  const edgeId = ctx.mutationId;
  return {
    checks: [
      ...(current
        ? [
            {
              target: edgeTarget(
                ctx,
                "placeholder_for",
                "GhostResource",
                "OpenRole",
                current.edgeId,
              ),
              change: { operation: "update" as const },
            },
          ]
        : []),
      {
        target: edgeTarget(ctx, "placeholder_for", "GhostResource", "OpenRole", edgeId),
        change: { operation: "create" },
      },
    ],
    async validate() {},
    async apply() {
      const changed: string[] = [];
      if (current) {
        await closeEdge(ctx.tx, ctx.principal.workspaceId, current.edgeId, ctx.now, {
          userId: ctx.principal.userId,
          at: ctx.now,
        });
        changed.push(current.edgeId);
      }
      await insertEdge(
        ctx.tx,
        ctx.principal.workspaceId,
        newEdge(ctx, {
          edgeId,
          edgeType: "placeholder_for",
          fromNodeId: ghost.nodeId,
          toNodeId: openRole.nodeId,
        }),
      );
      changed.push(edgeId);
      return { result: { success: true }, changedRowIds: changed };
    },
  };
};

export const ghostResourcePromote: ServerMutation<
  MutationArgs<"ghostResource.promote">
> = async (ctx) => {
  const ghost = await requireNode(ctx, ctx.args.ghost_id, "GhostResource");
  const employeeId = String(ghost.record["ghost_employee_id"]);
  const promotedEdgeId = ctx.mutationId;
  return {
    checks: [
      {
        target: nodeTarget(ctx, "GhostResource", ghost.nodeId),
        change: { operation: "update" },
      },
      {
        target: nodeTarget(ctx, "Employee", employeeId),
        change: { operation: "update" },
      },
      {
        target: edgeTarget(
          ctx,
          "promoted_to",
          "GhostResource",
          "Employee",
          promotedEdgeId,
        ),
        change: { operation: "create" },
      },
    ],
    async validate() {
      if (ctx.args.expected_version !== ghost.version) {
        if (ghost.lifecycleStatus === "Promoted") {
          throw new MutationRejection(
            `already-promoted:actor=${String(ghost.record["updated_by"])}:at=${String(ghost.record["updated_at"])}`,
          );
        }
        throw new MutationRejection("stale-state");
      }
      if ("existing_employee_id" in ctx.args.details)
        throw new MutationRejection("existing-employee-not-yet-supported");
      if (!ghostResourceTransition(ghost.lifecycleStatus, "Promoted"))
        throw new MutationRejection("invalid-transition");
      await requireNode(ctx, employeeId, "Employee");
      await requireUnique(
        ctx,
        {
          email: ctx.args.details.email,
          employee_code: ctx.args.details.employee_code,
        },
        employeeId,
      );
    },
    async apply() {
      if ("existing_employee_id" in ctx.args.details)
        throw new MutationRejection("existing-employee-not-yet-supported");
      const details = ctx.args.details;
      const promoted = await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        ghost.nodeId,
        ctx.args.expected_version,
        {
          lifecycle_status: "Promoted",
          ...updateStamp("GhostResource", provenance(ctx)),
        },
      );
      const employee = await requireNode(ctx, employeeId, "Employee");
      const updatedEmployee = await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        employee.nodeId,
        employee.version,
        {
          employee_type: "Employee",
          employee_code: details.employee_code,
          full_name: details.full_name,
          email: normalizeEmployeeEmail(details.email),
          employment_type: details.employment_type,
          start_date: details.start_date,
          ...(details.contracted_hours === undefined
            ? {}
            : { contracted_hours: details.contracted_hours }),
          ...updateStamp("Employee", provenance(ctx)),
        },
      );
      await insertEdge(
        ctx.tx,
        ctx.principal.workspaceId,
        newEdge(ctx, {
          edgeId: promotedEdgeId,
          edgeType: "promoted_to",
          fromNodeId: ghost.nodeId,
          toNodeId: employee.nodeId,
        }),
      );
      return {
        result: { status: "promoted" },
        changedRowIds: [promoted.nodeId, updatedEmployee.nodeId, promotedEdgeId],
      };
    },
  };
};
