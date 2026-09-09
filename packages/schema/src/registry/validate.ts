import {
  ENDPOINT_SETS,
  EDGE_GROUPS,
  EDGE_REGISTRY,
  EDGE_SOURCE_ROW_COUNT,
  type EdgeRegistration,
  type RegistryEndpoint,
} from "./edges";
import { assertAnonymityRegistry } from "./anonymity";
import { CONVERSION_REGISTRY } from "./conversions";
import { NODE_REGISTRY, type NodeType } from "./nodes";
import { OWNERSHIP_REGISTRY } from "./ownership";
import { DEFAULT_PRIVACY_CLASS_TIERS, getProtectionPartitions } from "./protection";
import {
  PRIVACY_CLASSES,
  type DataTier,
  type NodeRegistrationShape,
  type PrivacyClass,
} from "./types";

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

const isDataTier = (value: unknown): value is DataTier =>
  value === 0 || value === 1 || value === 2 || value === 3;

const assertConcreteProtection = (
  nodeType: string,
  privacyClass: unknown,
  tier: unknown,
  departureDeclared: boolean,
  splitDeclared: boolean,
): void => {
  if (
    privacyClass === "Inherited" ||
    !PRIVACY_CLASSES.includes(privacyClass as PrivacyClass)
  ) {
    throw new Error(
      `Unknown concrete Privacy Class on ${nodeType}: ${String(privacyClass)}`,
    );
  }
  if (!isDataTier(tier)) {
    throw new Error(`Invalid protection tier on ${nodeType}: ${String(tier)}`);
  }
  const defaultTier =
    DEFAULT_PRIVACY_CLASS_TIERS[privacyClass as Exclude<PrivacyClass, "Inherited">];
  if (tier !== defaultTier && !departureDeclared && !splitDeclared) {
    throw new Error(
      `Unmarked Privacy Class tier departure on ${nodeType}: ${privacyClass} defaults to ${defaultTier}, received ${tier}`,
    );
  }
};

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

    if (node.protection.kind === "fixed") {
      assertConcreteProtection(
        node.nodeType,
        node.protection.privacyClass,
        node.protection.tier,
        node.protection.tierDepartureReason !== undefined,
        false,
      );
    } else if (node.protection.kind === "split") {
      const [first, second] = node.protection.partitions;
      if (first.key === second.key) {
        throw new Error(`Duplicate protection partition: ${node.nodeType}`);
      }
      for (const partition of node.protection.partitions) {
        assertConcreteProtection(
          `${node.nodeType}/${partition.key}`,
          partition.privacyClass,
          partition.tier,
          false,
          true,
        );
      }
    } else if (
      node.protection.privacyClass !== "Inherited" ||
      node.protection.tier !== "Inherited"
    ) {
      throw new Error(`Malformed inherited protection on ${node.nodeType}`);
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

/**
 * F136 / FDN-92. Every `governingPartitions` entry on an edge group must name
 * a **split** endpoint node type of that group and one of that type's real
 * partition keys. A declaration for a single-partition type, an unknown
 * partition key, or a node type that is not a direct endpoint of the group
 * fails the registry at import — the same fail-loud discipline the rest of
 * this file uses. (Endpoint-set positions resolving to a split concrete type
 * are a future extension, added with the first feature that needs one.)
 */
export interface GoverningPartitionGroup {
  readonly edgeType: string;
  readonly pairs: readonly (readonly [RegistryEndpoint, RegistryEndpoint])[];
  readonly governingPartitions?: Readonly<Partial<Record<NodeType, string>>>;
}

export const assertGoverningPartitions = (
  groups: readonly GoverningPartitionGroup[] = EDGE_GROUPS,
): void => {
  for (const group of groups) {
    if (group.governingPartitions === undefined) continue;
    const directEndpoints = new Set(group.pairs.flatMap(([from, to]) => [from, to]));
    for (const [nodeType, partitionKey] of Object.entries(group.governingPartitions)) {
      if (partitionKey === undefined) continue;
      if (!directEndpoints.has(nodeType as NodeType)) {
        throw new Error(
          `governingPartitions on ${group.edgeType} names ${nodeType}, which is not a direct endpoint of it`,
        );
      }
      const partitions = getProtectionPartitions(nodeType as NodeType);
      if (partitions.length <= 1) {
        throw new Error(
          `governingPartitions on ${group.edgeType} names ${nodeType}, which is not split (${partitions.length} partition${partitions.length === 1 ? "" : "s"})`,
        );
      }
      if (!partitions.some((partition) => partition.key === partitionKey)) {
        throw new Error(
          `governingPartitions on ${group.edgeType} names partition "${partitionKey}" for ${nodeType}, whose partitions are: ${partitions.map(({ key }) => key).join(", ")}`,
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

  const mappedClasses = Object.keys(DEFAULT_PRIVACY_CLASS_TIERS);
  const expectedMappedClasses = PRIVACY_CLASSES.filter(
    (privacyClass) => privacyClass !== "Inherited",
  );
  requireUnique(mappedClasses, "default Privacy Class tier mapping");
  if (
    mappedClasses.length !== expectedMappedClasses.length ||
    expectedMappedClasses.some((privacyClass) => !mappedClasses.includes(privacyClass))
  ) {
    throw new Error("Default Privacy Class tier mapping is not total");
  }

  if (OWNERSHIP_REGISTRY.length !== 10) {
    throw new Error(
      `Expected 10 ownership registrations, got ${OWNERSHIP_REGISTRY.length}`,
    );
  }

  assertUniversalFieldPolicies();
  assertGoverningPartitions();
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
