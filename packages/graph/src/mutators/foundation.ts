import {
  MUTATIONS,
  employeeOperationalRecord,
  employeeTransitionOutcome,
  FEATURE_LIFECYCLE_NODE_TYPES,
  getMutationDefinition,
  isNodeType,
  isTier0Only,
  moveEmployeeEdgeId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  wouldCreateCycle,
  type MutationName,
  type NodeType,
} from "@vulto/schema";
import type { CachedEdge, CachedNode, OptimisticCache, UndoEntry } from "./cache";

/**
 * The optimistic halves of the foundation mutations (A003-T53). Each applies a
 * mutation's effect to the device cache at once and returns the before-images
 * that revert it. They decide nothing about access: the client may hide an
 * action a person cannot take, never grant one, and the server's answer is
 * final. They do share the definition's input schema, the provenance stamps and
 * the Tier 0 and loop rules with the server, so what shows here is what
 * replication later delivers.
 */

/** A refusal decided locally, before the mutation is queued. */
export class OptimisticRejection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "OptimisticRejection";
  }
}

export interface MutatorContext {
  readonly cache: OptimisticCache;
  readonly workspaceId: string;
  readonly userId: string;
  readonly mutationId: string;
  /** UTC ISO-8601 time for provenance stamps. */
  readonly now: string;
}

export type OptimisticMutator = (
  context: MutatorContext,
  args: unknown,
) => Promise<UndoEntry[]>;

const provenance = (c: MutatorContext) => ({
  workspaceId: c.workspaceId,
  userId: c.userId,
  now: c.now,
});

const toCachedNode = (
  record: Record<string, unknown>,
  version: number,
): CachedNode => ({
  nodeId: String(record["node_id"]),
  nodeType: String(record["node_type"]),
  lifecycleStatus: String(record["lifecycle_status"]),
  isSoftDeleted: record["is_soft_deleted"] === true,
  version,
  record,
});

const toCachedEdge = (
  record: Record<string, unknown>,
  version: number,
): CachedEdge => ({
  edgeId: String(record["edge_id"]),
  edgeType: String(record["edge_type"]),
  fromNodeId: String(record["from_node_id"]),
  toNodeId: String(record["to_node_id"]),
  effectiveFrom: (record["effective_from"] as string | null) ?? null,
  effectiveTo: (record["effective_to"] as string | null) ?? null,
  isSoftDeleted: record["is_soft_deleted"] === true,
  version,
  record,
});

async function liveNode(cache: OptimisticCache, nodeId: string): Promise<CachedNode> {
  const node = await cache.getNode(nodeId);
  if (!node) throw new OptimisticRejection("not-found");
  if (node.isSoftDeleted) throw new OptimisticRejection("target-deleted");
  return node;
}

function parse<Name extends MutationName>(name: Name, args: unknown) {
  const parsed = MUTATIONS[name].input.safeParse(args);
  if (!parsed.success) throw new OptimisticRejection("invalid-args");
  return parsed.data as never as Record<string, unknown> &
    import("@vulto/schema").MutationArgs<Name>;
}

/** Applies a new version of a node, returning what it replaced. */
async function writeNode(
  cache: OptimisticCache,
  before: CachedNode,
  record: Record<string, unknown>,
): Promise<UndoEntry> {
  await cache.putNode(toCachedNode(record, before.version + 1));
  return { kind: "node", id: before.nodeId, before };
}

const createNode: OptimisticMutator = async (c, raw) => {
  const { node } = parse("graph.createNode", raw);
  const type = node["node_type"];
  if (
    typeof type !== "string" ||
    !isNodeType(type) ||
    typeof node["node_id"] !== "string"
  ) {
    throw new OptimisticRejection("invalid-args");
  }
  if (!isTier0Only(type as NodeType))
    throw new OptimisticRejection("requires-feature-mutation");
  if (await c.cache.getNode(node["node_id"]))
    throw new OptimisticRejection("invalid-args");
  const stamped = stampNewNode(node, type as NodeType, provenance(c));
  await c.cache.putNode(toCachedNode(stamped, 1));
  return [{ kind: "node", id: node["node_id"], before: null }];
};

const updateNodeFields: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.updateNodeFields", raw);
  const node = await liveNode(c.cache, args.node_id);
  if (!isTier0Only(node.nodeType as NodeType)) {
    throw new OptimisticRejection("requires-feature-mutation");
  }
  if (args.expected_version !== null && args.expected_version !== node.version) {
    throw new OptimisticRejection("stale-state");
  }
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      ...args.patch,
      ...updateStamp(node.nodeType, provenance(c)),
    }),
  ];
};

const softDeleteNode: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.softDeleteNode", raw);
  const node = await liveNode(c.cache, args.node_id);
  const anonymous =
    node.record["created_at"] === undefined && node.record["updated_at"] === undefined;
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      is_soft_deleted: true,
      ...(anonymous ? {} : { soft_deleted_at: c.now, soft_deleted_by: c.userId }),
    }),
  ];
};

const createEdge: OptimisticMutator = async (c, raw) => {
  const { edge } = parse("graph.createEdge", raw);
  const edgeId = edge["edge_id"];
  if (typeof edgeId !== "string" || (await c.cache.getEdge(edgeId))) {
    throw new OptimisticRejection("invalid-args");
  }
  await liveNode(c.cache, String(edge["from_node_id"]));
  await liveNode(c.cache, String(edge["to_node_id"]));
  await c.cache.putEdge(toCachedEdge(stampNewEdge(edge, provenance(c)), 1));
  return [{ kind: "edge", id: edgeId, before: null }];
};

async function closeAt(
  cache: OptimisticCache,
  edge: CachedEdge,
  effectiveTo: string,
): Promise<UndoEntry> {
  if (edge.effectiveTo !== null) throw new OptimisticRejection("invalid-args");
  if (
    edge.effectiveFrom !== null &&
    Date.parse(effectiveTo) <= Date.parse(edge.effectiveFrom)
  ) {
    throw new OptimisticRejection("invalid-args");
  }
  await cache.putEdge(
    toCachedEdge({ ...edge.record, effective_to: effectiveTo }, edge.version + 1),
  );
  return { kind: "edge", id: edge.edgeId, before: edge };
}

const closeEdge: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.closeEdge", raw);
  const edge = await c.cache.getEdge(args.edge_id);
  if (!edge) throw new OptimisticRejection("not-found");
  return [await closeAt(c.cache, edge, args.effective_to)];
};

const transitionLifecycle: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.transitionLifecycle", raw);
  const node = await liveNode(c.cache, args.node_id);
  if (FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType))
    throw new OptimisticRejection("requires-feature-mutation");
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      lifecycle_status: args.to_status,
      ...updateStamp(node.nodeType, provenance(c)),
    }),
  ];
};

const moveEmployee: OptimisticMutator = async (c, raw) => {
  const args = parse("org.moveEmployee", raw);
  const employee = await liveNode(c.cache, args.employee_id);
  if (employee.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
  const activeAt = (edge: CachedEdge) =>
    !edge.isSoftDeleted &&
    (edge.effectiveFrom === null ||
      Date.parse(edge.effectiveFrom) <= Date.parse(args.effective_from)) &&
    (edge.effectiveTo === null ||
      Date.parse(edge.effectiveTo) > Date.parse(args.effective_from));
  if (args.new_manager_id !== null) {
    const manager = await liveNode(c.cache, args.new_manager_id);
    if (manager.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
    const managerOf = async (id: string) =>
      (await c.cache.edgesFrom(id, "managed_by")).find(activeAt)?.toNodeId ?? null;
    if (await wouldCreateCycle(managerOf, args.employee_id, args.new_manager_id)) {
      throw new OptimisticRejection("cycle");
    }
  }
  const prior = (await c.cache.edgesFrom(args.employee_id, "managed_by")).find(
    (edge) => !edge.isSoftDeleted && edge.effectiveTo === null,
  );
  if ((prior?.toNodeId ?? null) === args.new_manager_id) {
    throw new OptimisticRejection("no-change");
  }
  const undo: UndoEntry[] = [];
  if (prior) undo.push(await closeAt(c.cache, prior, args.effective_from));
  if (args.new_manager_id !== null) {
    const edgeId = moveEmployeeEdgeId(c.mutationId);
    await c.cache.putEdge(
      toCachedEdge(
        stampNewEdge(
          {
            edge_id: edgeId,
            edge_type: "managed_by",
            from_node_id: args.employee_id,
            to_node_id: args.new_manager_id,
            effective_from: args.effective_from,
            effective_to: null,
          },
          provenance(c),
        ),
        1,
      ),
    );
    undo.push({ kind: "edge", id: edgeId, before: null });
  }
  return undo;
};

// ── Employee (RST-33) ───────────────────────────────────────────────────────

const liveEmployee = async (cache: OptimisticCache, id: string) => {
  const node = await liveNode(cache, id);
  if (node.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
  return node;
};

const employeeCreate: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.create", raw);
  if (await c.cache.getNode(args.employee_id))
    throw new OptimisticRejection("invalid-args");
  const entity = await c.cache.getNode(args.entity_id);
  if (!entity || entity.nodeType !== "Entity" || entity.isSoftDeleted)
    throw new OptimisticRejection("invalid-args");
  const node = stampNewNode(
    {
      node_id: args.employee_id,
      node_type: "Employee",
      schema_version: 1,
      lifecycle_status: "Active",
      ...employeeOperationalRecord(args.fields),
    },
    "Employee",
    provenance(c),
  );
  await c.cache.putNode(toCachedNode(node, 1));
  const edgeId = moveEmployeeEdgeId(c.mutationId);
  await c.cache.putEdge(
    toCachedEdge(
      stampNewEdge(
        {
          edge_id: edgeId,
          edge_type: "scoped_to_entity",
          from_node_id: args.employee_id,
          to_node_id: args.entity_id,
          effective_from: args.effective_from,
          effective_to: null,
        },
        provenance(c),
      ),
      1,
    ),
  );
  return [
    { kind: "node", id: args.employee_id, before: null },
    { kind: "edge", id: edgeId, before: null },
  ];
};

const employeeUpdate: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.update", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  const patch = { ...args.patch } as Record<string, unknown>;
  if (typeof patch["email"] === "string") patch["email"] = patch["email"].toLowerCase();
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      ...patch,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

const employeeTransitionStatus: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.transitionStatus", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  const outcome = employeeTransitionOutcome(
    node.lifecycleStatus,
    args.to_status,
    args.end_date,
    (node.record["end_date"] as string | null | undefined) ?? null,
  );
  if (!outcome.ok) throw new OptimisticRejection(outcome.reason);
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      lifecycle_status: args.to_status,
      end_date: outcome.endDate,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

const employeeLinkUser: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.linkUser", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      user_id: args.user_id,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

/** Tier 1: never applied to the cache, because a protected value never reaches one. */
const employeeSetCompensation: OptimisticMutator = async (_c, raw) => {
  parse("employee.setCompensation", raw);
  return [];
};

export const OPTIMISTIC_MUTATORS: Readonly<Record<MutationName, OptimisticMutator>> = {
  "employee.create": employeeCreate,
  "employee.update": employeeUpdate,
  "employee.transitionStatus": employeeTransitionStatus,
  "employee.linkUser": employeeLinkUser,
  "employee.setCompensation": employeeSetCompensation,
  "graph.createNode": createNode,
  "graph.updateNodeFields": updateNodeFields,
  "graph.softDeleteNode": softDeleteNode,
  "graph.createEdge": createEdge,
  "graph.closeEdge": closeEdge,
  "graph.transitionLifecycle": transitionLifecycle,
  "org.moveEmployee": moveEmployee,
};

/** Applies a named mutation to the cache, or throws `OptimisticRejection`. */
export async function applyOptimistic(
  context: MutatorContext,
  name: string,
  args: unknown,
): Promise<UndoEntry[]> {
  if (!getMutationDefinition(name)) throw new OptimisticRejection("unknown-mutation");
  return OPTIMISTIC_MUTATORS[name as MutationName](context, args);
}
