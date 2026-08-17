import { EDGE_REGISTRY, ENDPOINT_SETS, type EdgeType } from "./edges";
import { NODE_REGISTRY, type NodeType } from "./nodes";
import { type NodeRegistrationShape } from "./types";

export interface AllowedAnonymousRelationship {
  readonly edgeType: EdgeType;
  readonly direction: "incoming" | "outgoing";
  readonly otherNodeType: NodeType;
}

export interface AnonymityRegistration {
  readonly nodeType: NodeType;
  readonly allowedRelationships: readonly AllowedAnonymousRelationship[];
}

interface AnonymityDefinition {
  readonly nodes: readonly Pick<
    NodeRegistrationShape,
    "nodeType" | "universalFields"
  >[];
  readonly edges: readonly {
    readonly edgeType: string;
    readonly fromNodeType: string;
    readonly toNodeType: string;
  }[];
  readonly registrations: readonly {
    readonly nodeType: string;
    readonly allowedRelationships: readonly {
      readonly edgeType: string;
      readonly direction: "incoming" | "outgoing";
      readonly otherNodeType: string;
    }[];
  }[];
  readonly endpointSets: readonly string[];
}

/**
 * F90's closed connectivity contract. An anonymity-protected node never
 * inherits an endpoint-set relationship: every permitted connection is an
 * exact triple enumerated here. Future protected nodes must add their own
 * entry, even when the permitted relationship set is empty.
 */
export const ANONYMITY_REGISTRY = [
  {
    nodeType: "PulseAggregateContribution",
    allowedRelationships: [
      {
        edgeType: "part_of",
        direction: "outgoing",
        otherNodeType: "PulseCycle",
      },
    ],
  },
  {
    nodeType: "WellnessAggregateContribution",
    allowedRelationships: [],
  },
] as const satisfies readonly AnonymityRegistration[];

const actualRelationships = (
  definition: AnonymityDefinition,
  nodeType: string,
): readonly AnonymityDefinition["registrations"][number]["allowedRelationships"][number][] => {
  const nodeTypes = new Set(definition.nodes.map((node) => node.nodeType));
  const endpointSets = new Set(definition.endpointSets);

  return definition.edges.flatMap((edge) => {
    const relationships: {
      edgeType: string;
      direction: "incoming" | "outgoing";
      otherNodeType: string;
    }[] = [];

    if (edge.fromNodeType === nodeType) {
      if (nodeTypes.has(edge.toNodeType) && !endpointSets.has(edge.toNodeType)) {
        relationships.push({
          edgeType: edge.edgeType,
          direction: "outgoing",
          otherNodeType: edge.toNodeType,
        });
      } else {
        throw new Error(
          `Anonymity-protected ${nodeType} has non-exact outgoing endpoint on ${edge.edgeType}`,
        );
      }
    }

    if (edge.toNodeType === nodeType) {
      if (nodeTypes.has(edge.fromNodeType) && !endpointSets.has(edge.fromNodeType)) {
        relationships.push({
          edgeType: edge.edgeType,
          direction: "incoming",
          otherNodeType: edge.fromNodeType,
        });
      } else {
        throw new Error(
          `Anonymity-protected ${nodeType} has non-exact incoming endpoint on ${edge.edgeType}`,
        );
      }
    }

    return relationships;
  });
};

const relationshipKey = (relationship: {
  readonly edgeType: string;
  readonly direction: "incoming" | "outgoing";
  readonly otherNodeType: string;
}): string =>
  `${relationship.edgeType}\u0000${relationship.direction}\u0000${relationship.otherNodeType}`;

/** Internal validator exported for malformed-registry fixtures, not package API. */
export const validateAnonymityDefinition = (definition: AnonymityDefinition): void => {
  const protectedNodeTypes = definition.nodes
    .filter(({ universalFields }) => universalFields === "anonymous-contribution")
    .map(({ nodeType }) => nodeType);

  const registeredNodeTypes = new Set(
    definition.registrations.map(({ nodeType }) => nodeType),
  );

  if (
    protectedNodeTypes.length !== registeredNodeTypes.size ||
    protectedNodeTypes.some((nodeType) => !registeredNodeTypes.has(nodeType))
  ) {
    throw new Error(
      "Every anonymity-protected node must have one explicit anonymity registration",
    );
  }

  for (const registration of definition.registrations) {
    const expected = registration.allowedRelationships.map(relationshipKey).sort();
    const actual = actualRelationships(definition, registration.nodeType)
      .map(relationshipKey)
      .sort();

    if (expected.join("\n") !== actual.join("\n")) {
      throw new Error(
        `Anonymity relationship mismatch for ${registration.nodeType}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
      );
    }
  }
};

export const assertAnonymityRegistry = (): void =>
  validateAnonymityDefinition({
    nodes: NODE_REGISTRY,
    edges: EDGE_REGISTRY,
    registrations: ANONYMITY_REGISTRY,
    endpointSets: ENDPOINT_SETS,
  });
