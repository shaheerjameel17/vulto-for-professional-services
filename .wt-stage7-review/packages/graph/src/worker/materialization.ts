import {
  assertRegisteredRelationship,
  getNodeRegistration,
  getProtectionPartitions,
  parseEdgeRecord,
  parseNodeRecord,
  type EdgeRecord,
  type NodeRecord,
  type NodeType,
} from "@vulto/schema";

export interface NodeFragmentInput {
  readonly sourceDocumentId: string;
  readonly partitionKey: string;
  readonly record: unknown;
}

export interface EdgeInput {
  readonly sourceDocumentId: string;
  readonly record: unknown;
}

export interface GraphMaterializationSnapshot {
  readonly nodeFragments: readonly NodeFragmentInput[];
  readonly edges: readonly EdgeInput[];
}

export interface GraphMaterializationBatch extends GraphMaterializationSnapshot {
  readonly removeSourceDocumentIds?: readonly string[];
}

export interface ValidatedNodeFragment {
  readonly sourceDocumentId: string;
  readonly partitionKey: string;
  readonly record: NodeRecord;
}

export interface ValidatedEdge {
  readonly sourceDocumentId: string;
  readonly record: EdgeRecord;
}

export interface ValidatedGraphSnapshot {
  readonly nodeFragments: readonly ValidatedNodeFragment[];
  readonly edges: readonly ValidatedEdge[];
}

const universalKeys = [
  "node_type",
  "schema_version",
  "lifecycle_status",
  "workspace_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "is_soft_deleted",
  "soft_deleted_at",
  "soft_deleted_by",
] as const;

function requireSourceDocumentId(value: string): void {
  if (value.trim().length === 0) {
    throw new Error("sourceDocumentId must not be empty");
  }
}

function validatePartition(nodeType: NodeType, partitionKey: string): void {
  if (partitionKey.length === 0) throw new Error("partitionKey must not be empty");

  const protection = getNodeRegistration(nodeType).protection;
  if (protection.kind === "inherited") return;

  const allowed = getProtectionPartitions(nodeType).map(({ key }) => key);
  if (!allowed.includes(partitionKey)) {
    throw new Error(
      `${nodeType} fragment ${partitionKey} is not one of its registered partitions: ${allowed.join(", ")}`,
    );
  }
}

function assertUniversalFieldsAgree(
  first: NodeRecord,
  next: NodeRecord,
  nodeId: string,
): void {
  const firstRecord = first as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of universalKeys) {
    if (firstRecord[key] !== nextRecord[key]) {
      throw new Error(`Node ${nodeId} has conflicting ${key} across fragments`);
    }
  }
}

function intervalStart(edge: EdgeRecord): number {
  return edge.effective_from === null
    ? Number.NEGATIVE_INFINITY
    : Date.parse(edge.effective_from);
}

function intervalEnd(edge: EdgeRecord): number {
  return edge.effective_to === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(edge.effective_to);
}

function validateSingleActiveOutgoing(
  edges: readonly ValidatedEdge[],
  nodeTypes: ReadonlyMap<string, NodeType>,
): void {
  const histories = new Map<string, EdgeRecord[]>();

  for (const { record } of edges) {
    if (record.is_soft_deleted) continue;
    const fromNodeType = nodeTypes.get(record.from_node_id);
    const toNodeType = nodeTypes.get(record.to_node_id);
    if (fromNodeType === undefined || toNodeType === undefined) continue;
    const registration = assertRegisteredRelationship(
      record.edge_type,
      fromNodeType,
      toNodeType,
    );
    if (registration.historyPolicy !== "single-active-outgoing") continue;
    const key = `${record.edge_type}\u0000${record.from_node_id}`;
    const history = histories.get(key) ?? [];
    history.push(record);
    histories.set(key, history);
  }

  for (const [key, history] of histories) {
    history.sort((left, right) => intervalStart(left) - intervalStart(right));
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1]!;
      const current = history[index]!;
      if (intervalStart(current) < intervalEnd(previous)) {
        const [edgeType, sourceNodeId] = key.split("\u0000");
        throw new Error(
          `${edgeType} has overlapping active history for source ${sourceNodeId}: ${previous.edge_id} overlaps ${current.edge_id}`,
        );
      }
    }
  }
}

export function validateGraphSnapshot(
  snapshot: GraphMaterializationSnapshot,
  workspaceId: string,
): ValidatedGraphSnapshot {
  const fragments = snapshot.nodeFragments.map((fragment) => {
    requireSourceDocumentId(fragment.sourceDocumentId);
    const record = parseNodeRecord(fragment.record);
    validatePartition(record.node_type, fragment.partitionKey);
    if ("workspace_id" in record && record.workspace_id !== workspaceId) {
      throw new Error(
        `Node ${record.node_id} belongs to workspace ${String(record.workspace_id)}, not ${workspaceId}`,
      );
    }
    if (record.node_type === "Workspace" && record.node_id !== workspaceId) {
      throw new Error(`Workspace node ${record.node_id} does not match ${workspaceId}`);
    }
    return { ...fragment, record };
  });

  const fragmentKeys = new Set<string>();
  const nodeTypes = new Map<string, NodeType>();
  const firstFragments = new Map<string, NodeRecord>();
  for (const fragment of fragments) {
    const key = `${fragment.record.node_id}\u0000${fragment.partitionKey}`;
    if (fragmentKeys.has(key)) {
      throw new Error(
        `Duplicate materialized fragment ${fragment.record.node_id}/${fragment.partitionKey}`,
      );
    }
    fragmentKeys.add(key);
    const existingType = nodeTypes.get(fragment.record.node_id);
    if (existingType !== undefined && existingType !== fragment.record.node_type) {
      throw new Error(`Node ${fragment.record.node_id} has conflicting node types`);
    }
    nodeTypes.set(fragment.record.node_id, fragment.record.node_type);
    const first = firstFragments.get(fragment.record.node_id);
    if (first === undefined)
      firstFragments.set(fragment.record.node_id, fragment.record);
    else assertUniversalFieldsAgree(first, fragment.record, fragment.record.node_id);
  }

  const edges = snapshot.edges.map((edge) => {
    requireSourceDocumentId(edge.sourceDocumentId);
    return { ...edge, record: parseEdgeRecord(edge.record) };
  });
  const edgeIds = new Set<string>();
  for (const { record } of edges) {
    if (edgeIds.has(record.edge_id)) {
      throw new Error(`Duplicate materialized edge ${record.edge_id}`);
    }
    edgeIds.add(record.edge_id);
    const fromNodeType = nodeTypes.get(record.from_node_id);
    const toNodeType = nodeTypes.get(record.to_node_id);
    if (fromNodeType === undefined || toNodeType === undefined) {
      throw new Error(
        `Edge ${record.edge_id} references an endpoint absent from the local materialization`,
      );
    }
    assertRegisteredRelationship(record.edge_type, fromNodeType, toNodeType);
  }
  validateSingleActiveOutgoing(edges, nodeTypes);

  return { nodeFragments: fragments, edges };
}

export function applyGraphBatch(
  current: ValidatedGraphSnapshot,
  batch: GraphMaterializationBatch,
  workspaceId: string,
): ValidatedGraphSnapshot {
  const removed = new Set(batch.removeSourceDocumentIds ?? []);
  const nodes = new Map(
    current.nodeFragments
      .filter(({ sourceDocumentId }) => !removed.has(sourceDocumentId))
      .map((fragment) => [
        `${fragment.record.node_id}\u0000${fragment.partitionKey}`,
        fragment,
      ]),
  );
  for (const fragment of batch.nodeFragments) {
    const parsed = parseNodeRecord(fragment.record);
    nodes.set(`${parsed.node_id}\u0000${fragment.partitionKey}`, {
      ...fragment,
      record: parsed,
    });
  }

  const edges = new Map(
    current.edges
      .filter(({ sourceDocumentId }) => !removed.has(sourceDocumentId))
      .map((edge) => [edge.record.edge_id, edge]),
  );
  for (const edge of batch.edges) {
    const parsed = parseEdgeRecord(edge.record);
    edges.set(parsed.edge_id, { ...edge, record: parsed });
  }

  return validateGraphSnapshot(
    {
      nodeFragments: [...nodes.values()],
      edges: [...edges.values()],
    },
    workspaceId,
  );
}
