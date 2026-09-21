import {
  employeeOperationalRecord,
  employeeTransitionOutcome,
  EMPLOYEE_COMPENSATION_PARTITION,
  moveEmployeeEdgeId,
  normalizeEmployeeEmail,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type JsonValue,
  type MutationArgs,
} from "@vulto/schema";
import { getKeyServices } from "../crypto/keys.js";
import {
  findNodeByRecordField,
  getNode,
  GraphNotFoundError,
  GraphValidationError,
  insertEdge,
  insertNode,
  StaleVersionError,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import { writeProtected } from "../protected/write.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
} from "./types.js";

/**
 * Employee's server mutations (RST-33, VRS-F002). The server is the only
 * writer and validates before it commits. Employee is tier-split, so each
 * mutation routes its fields to the right half: the operational (Tier 0) half
 * into `graph_nodes.record`, the compensation (Tier 1) half through
 * `writeProtected`. Nothing here decides access; the pipeline authorizes every
 * check first.
 */

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

const translate = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StaleVersionError) throw new MutationRejection("stale-state");
    if (error instanceof GraphNotFoundError) throw new MutationRejection("not-found");
    if (error instanceof GraphValidationError)
      throw new MutationRejection("invalid-args");
    throw error;
  }
};

async function requireEmployee(
  ctx: MutationContext<unknown>,
  employeeId: string,
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, employeeId);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== "Employee") throw new MutationRejection("invalid-args");
  return node;
}

const employeeTarget = (
  ctx: MutationContext<unknown>,
  employeeId: string,
  partitionKey?: string,
) =>
  ({
    kind: "node",
    workspaceId: ctx.principal.workspaceId,
    nodeType: "Employee",
    nodeId: employeeId,
    ...(partitionKey === undefined ? {} : { partitionKey }),
  }) as const;

/** Email and code are unique within a workspace, not globally (VRS-F002). */
async function requireUnique(
  ctx: MutationContext<unknown>,
  fields: { email?: string; employee_code?: string },
  excludeNodeId?: string,
): Promise<void> {
  const workspaceId = ctx.principal.workspaceId;
  const options = excludeNodeId === undefined ? {} : { excludeNodeId };
  if (fields.email !== undefined) {
    const clash = await findNodeByRecordField(
      ctx.tx,
      workspaceId,
      "Employee",
      "email",
      normalizeEmployeeEmail(fields.email),
      options,
    );
    if (clash) throw new MutationRejection("duplicate-email");
  }
  if (fields.employee_code !== undefined) {
    const clash = await findNodeByRecordField(
      ctx.tx,
      workspaceId,
      "Employee",
      "employee_code",
      fields.employee_code,
      options,
    );
    if (clash) throw new MutationRejection("duplicate-code");
  }
}

export const employeeCreate: ServerMutation<MutationArgs<"employee.create">> = async (
  ctx,
) => {
  const { employee_id: employeeId, entity_id: entityId, fields } = ctx.args;
  const workspaceId = ctx.principal.workspaceId;
  const entity = await getNode(ctx.tx, workspaceId, entityId);
  if (!entity || entity.isSoftDeleted || entity.nodeType !== "Entity") {
    throw new MutationRejection("invalid-args");
  }
  const edgeId = moveEmployeeEdgeId(ctx.mutationId);
  return {
    checks: [
      {
        target: employeeTarget(ctx, employeeId),
        change: { operation: "create" },
      },
      {
        target: {
          kind: "edge",
          workspaceId,
          edgeType: "scoped_to_entity",
          fromNodeType: "Employee",
          toNodeType: "Entity",
          edgeId,
        },
        change: { operation: "create" },
      },
    ],
    async validate() {
      await requireUnique(ctx, {
        email: fields.email,
        employee_code: fields.employee_code,
      });
    },
    async apply() {
      const stored = await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: employeeId,
              node_type: "Employee",
              schema_version: 1,
              lifecycle_status: "Active",
              ...employeeOperationalRecord(fields),
            },
            "Employee",
            provenance(ctx),
          ),
        ),
      );
      const edge = await translate(() =>
        insertEdge(
          ctx.tx,
          workspaceId,
          stampNewEdge(
            {
              edge_id: edgeId,
              edge_type: "scoped_to_entity",
              from_node_id: employeeId,
              to_node_id: entityId,
              effective_from: ctx.args.effective_from,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      return {
        result: {
          node_id: stored.nodeId,
          version: stored.version,
          edge_id: edge.edgeId,
        },
        changedRowIds: [stored.nodeId, edge.edgeId],
      };
    },
  };
};

export const employeeUpdate: ServerMutation<MutationArgs<"employee.update">> = async (
  ctx,
) => {
  const node = await requireEmployee(ctx, ctx.args.employee_id);
  const patch = { ...ctx.args.patch } as Record<string, unknown>;
  if (typeof patch["email"] === "string") {
    patch["email"] = normalizeEmployeeEmail(patch["email"]);
  }
  return {
    checks: [
      { target: employeeTarget(ctx, node.nodeId), change: { operation: "update" } },
    ],
    async validate() {
      if (typeof patch["email"] === "string") {
        await requireUnique(ctx, { email: patch["email"] }, node.nodeId);
      }
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          node.nodeId,
          ctx.args.expected_version,
          { ...patch, ...updateStamp("Employee", provenance(ctx)) },
        ),
      );
      return {
        result: { node_id: updated.nodeId, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

/** `VRS-F002` G06, decided on the server before the mutation commits (A003-T54). */
export const employeeTransitionStatus: ServerMutation<
  MutationArgs<"employee.transitionStatus">
> = async (ctx) => {
  const node = await requireEmployee(ctx, ctx.args.employee_id);
  return {
    checks: [
      { target: employeeTarget(ctx, node.nodeId), change: { operation: "update" } },
    ],
    async validate() {
      // A stale decision is reported as stale, whatever it would have done to the current state.
      if (ctx.args.expected_version !== node.version) {
        throw new MutationRejection("stale-state");
      }
    },
    async apply() {
      const outcome = employeeTransitionOutcome(
        node.lifecycleStatus,
        ctx.args.to_status,
        ctx.args.end_date,
        ((node.record as Record<string, unknown>)["end_date"] as string | null) ?? null,
      );
      if (!outcome.ok) throw new MutationRejection(outcome.reason);
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          node.nodeId,
          ctx.args.expected_version,
          {
            lifecycle_status: ctx.args.to_status,
            end_date: outcome.endDate,
            ...updateStamp("Employee", provenance(ctx)),
          },
        ),
      );
      return {
        result: { node_id: updated.nodeId, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const employeeLinkUser: ServerMutation<
  MutationArgs<"employee.linkUser">
> = async (ctx) => {
  const node = await requireEmployee(ctx, ctx.args.employee_id);
  const workspaceId = ctx.principal.workspaceId;
  return {
    checks: [
      { target: employeeTarget(ctx, node.nodeId), change: { operation: "update" } },
    ],
    async validate() {
      // The login must be a person the graph already knows in this workspace: their
      // `User` node, written when they were admitted. Linking anyone else would
      // hand them somebody's "own record".
      const person = await getNode(ctx.tx, workspaceId, ctx.args.user_id);
      if (!person || person.isSoftDeleted || person.nodeType !== "User") {
        throw new MutationRejection("invalid-args");
      }
      const current = (node.record as Record<string, unknown>)["user_id"];
      if (current === ctx.args.user_id) throw new MutationRejection("no-change");
      if (current !== null && current !== undefined) {
        throw new MutationRejection("already-linked");
      }
      const taken = await findNodeByRecordField(
        ctx.tx,
        workspaceId,
        "Employee",
        "user_id",
        ctx.args.user_id,
        { excludeNodeId: node.nodeId },
      );
      if (taken) throw new MutationRejection("already-linked");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, workspaceId, node.nodeId, ctx.args.expected_version, {
          user_id: ctx.args.user_id,
          ...updateStamp("Employee", provenance(ctx)),
        }),
      );
      return {
        result: { node_id: updated.nodeId, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

/** The Tier 1 half: written encrypted, into the `compensation` partition, and nowhere else. */
export const employeeSetCompensation: ServerMutation<
  MutationArgs<"employee.setCompensation">
> = async (ctx) => {
  const node = await requireEmployee(ctx, ctx.args.employee_id);
  return {
    checks: [
      {
        target: employeeTarget(ctx, node.nodeId, EMPLOYEE_COMPENSATION_PARTITION),
        // The Employee is the subject: the reader set includes the person themselves.
        change: { operation: "update", subjectEmployeeId: node.nodeId },
      },
    ],
    async validate() {},
    async apply() {
      const written = await writeProtected(
        ctx.tx,
        getKeyServices(),
        {
          workspaceId: ctx.principal.workspaceId,
          nodeId: node.nodeId,
          nodeType: "Employee",
        },
        EMPLOYEE_COMPENSATION_PARTITION,
        ctx.args.compensation as unknown as JsonValue,
        ctx.principal.userId,
      );
      // Nothing on the Tier 0 row changed, so there is no audience row to recompute.
      return {
        result: { fragment_id: written.fragmentId, version: written.version },
        changedRowIds: [],
      };
    },
  };
};
