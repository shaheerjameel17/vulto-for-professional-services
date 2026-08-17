import {
  ENDPOINT_SETS,
  EDGE_GROUPS,
  EDGE_REGISTRY,
  EDGE_SOURCE_ROW_COUNT,
  type EdgeRegistration,
  type RegistryEndpoint,
} from "./edges.js";
import { assertAnonymityRegistry } from "./anonymity.js";
import { CONVERSION_REGISTRY } from "./conversions.js";
import { NODE_REGISTRY, type NodeType } from "./nodes.js";
import { OWNERSHIP_REGISTRY } from "./ownership.js";
import { PRIVACY_CLASSES, type NodeRegistrationShape } from "./types.js";

interface RegistryDefinition {
  readonly nodes: readonly NodeRegistrationShape[];
  readonly edges: readonly {
    readonly edgeType: string;
    readonly fromNodeType: string;
    readonly toNodeType: string;
    readonly owner: string;
  }[];
}

const requireUnique = (values: readonly string[], label: string): void => {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
};

const edgeKey = (edgeType: string, fromNodeType: string, toNodeType: string): string =>
  `${edgeType}\u0000${fromNodeType}\u0000${toNodeType}`;

/** Internal validator exported for malformed-registry fixtures, not package API. */
export const validateRegistryDefinition = (definition: RegistryDefinition): void => {
  requireUnique(
    definition.nodes.map(({ nodeType }) => nodeType),
    "node type",
  );

  const nodeTypes = new Set(definition.nodes.map(({ nodeType }) => nodeType));

  for (const node of definition.nodes) {
    if (node.owner.trim().length === 0) {
      throw new Error(`Node owner is empty: ${node.nodeType}`);
    }

    if (node.lifecycle.kind === "fixed") {
      requireUnique(node.lifecycle.statuses, `${node.nodeType} lifecycle status`);
      if (node.lifecycle.statuses.some((status) => status.trim().length === 0)) {
        throw new Error(`Empty lifecycle status: ${node.nodeType}`);
      }
    }

    if (node.protection.kind === "split") {
      const [first, second] = node.protection.partitions;
      if (first.key === second.key) {
        throw new Error(`Duplicate protection partition: ${node.nodeType}`);
      }
    }
  }

  requireUnique(
    definition.edges.map(({ edgeType, fromNodeType, toNodeType }) =>
      edgeKey(edgeType, fromNodeType, toNodeType),
    ),
    "edge triple",
  );

  for (const edge of definition.edges) {
    if (edge.owner.trim().length === 0) {
      throw new Error(`Edge owner is empty: ${edge.edgeType}`);
    }

    for (const endpoint of [edge.fromNodeType, edge.toNodeType]) {
      if (
        !ENDPOINT_SETS.includes(endpoint as (typeof ENDPOINT_SETS)[number]) &&
        !nodeTypes.has(endpoint)
      ) {
        throw new Error(
          `Unknown endpoint ${endpoint} in ${edge.edgeType} (${edge.fromNodeType} -> ${edge.toNodeType})`,
        );
      }
    }
  }
};

const assertUniversalFieldPolicies = (): void => {
  const expected = new Map<NodeType, NodeRegistrationShape["universalFields"]>([
    ["AuditEntry", "immutable-audit"],
    ["PulseAggregateContribution", "anonymous-contribution"],
    ["WellnessAggregateContribution", "anonymous-contribution"],
  ]);

  for (const node of NODE_REGISTRY) {
    const expectedPolicy = expected.get(node.nodeType) ?? "standard";
    if (node.universalFields !== expectedPolicy) {
      throw new Error(
        `Unexpected universal field policy for ${node.nodeType}: ${node.universalFields}`,
      );
    }
  }
};

export const assertCanonicalRegistry = (): void => {
  validateRegistryDefinition({ nodes: NODE_REGISTRY, edges: EDGE_REGISTRY });

  if (NODE_REGISTRY.length !== 109) {
    throw new Error(`Expected 109 node registrations, got ${NODE_REGISTRY.length}`);
  }

  const fixedLifecycleCount = NODE_REGISTRY.filter(
    ({ lifecycle }) => lifecycle.kind === "fixed",
  ).length;
  if (fixedLifecycleCount !== 28) {
    throw new Error(`Expected 28 fixed lifecycle policies, got ${fixedLifecycleCount}`);
  }

  if (EDGE_SOURCE_ROW_COUNT !== 83) {
    throw new Error(`Expected 83 source edge rows, got ${EDGE_SOURCE_ROW_COUNT}`);
  }

  if (EDGE_GROUPS.length !== 79) {
    throw new Error(`Expected 79 edge labels, got ${EDGE_GROUPS.length}`);
  }

  if (EDGE_REGISTRY.length !== 110) {
    throw new Error(
      `Expected 110 normalized edge triples, got ${EDGE_REGISTRY.length}`,
    );
  }

  if (PRIVACY_CLASSES.length !== 13) {
    throw new Error(`Expected 13 privacy classes, got ${PRIVACY_CLASSES.length}`);
  }

  if (OWNERSHIP_REGISTRY.length !== 10) {
    throw new Error(
      `Expected 10 ownership registrations, got ${OWNERSHIP_REGISTRY.length}`,
    );
  }

  assertUniversalFieldPolicies();
  assertAnonymityRegistry();

  const ownershipClaims = OWNERSHIP_REGISTRY.flatMap(({ nodeTypes }) => nodeTypes);
  requireUnique(ownershipClaims, "cross-suite ownership claim");

  for (const nodeType of ownershipClaims) {
    if (!NODE_REGISTRY.some((node) => node.nodeType === nodeType)) {
      throw new Error(`Ownership rule references unknown node type: ${nodeType}`);
    }
  }

  for (const conversion of CONVERSION_REGISTRY) {
    const source = NODE_REGISTRY.find(
      ({ nodeType }) => nodeType === conversion.sourceNodeType,
    );

    if (
      source?.lifecycle.kind !== "fixed" ||
      !source.lifecycle.statuses.includes(conversion.sourceTerminalStatus)
    ) {
      throw new Error(
        `Invalid conversion status for ${conversion.sourceNodeType}: ${conversion.sourceTerminalStatus}`,
      );
    }

    const edgeExists = EDGE_REGISTRY.some(
      (edge) =>
        edge.edgeType === conversion.edge.edgeType &&
        edge.fromNodeType === conversion.edge.fromNodeType &&
        edge.toNodeType === conversion.edge.toNodeType,
    );

    if (!edgeExists) {
      throw new Error(
        `Conversion references an unregistered edge: ${conversion.edge.edgeType}`,
      );
    }
  }
};

// Module initialization is deliberately loud: malformed canonical data cannot
// be imported and then treated as authoritative by a consumer.
assertCanonicalRegistry();

// Keep these imports type-checked as the canonical endpoint-set contract.
const _endpointContract: RegistryEndpoint = ENDPOINT_SETS[0];
const _edgeContract: EdgeRegistration | undefined = EDGE_REGISTRY[0];
void _endpointContract;
void _edgeContract;
