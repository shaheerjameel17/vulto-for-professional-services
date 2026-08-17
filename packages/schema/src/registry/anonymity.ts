import {
  EDGE_REGISTRY,
  matchesRegistryEndpoint,
  type EdgeType,
  type RegistryEndpoint,
} from "./edges.js";
import {
  isAnonymityProtectedNodeType,
  isNodeType,
  NODE_REGISTRY,
  type NodeType,
} from "./nodes.js";

export interface AllowedAnonymousRelationship {
  readonly edgeType: EdgeType;
  readonly direction: "incoming" | "outgoing";
  readonly otherNodeType: NodeType;
}

export interface AnonymityRegistration {
  readonly nodeType: NodeType;
  readonly allowedRelationships: readonly AllowedAnonymousRelationship[];
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

const endpointCanMatch = (endpoint: RegistryEndpoint, nodeType: NodeType): boolean =>
  matchesRegistryEndpoint(endpoint, nodeType);

const actualRelationships = (
  nodeType: NodeType,
): readonly AllowedAnonymousRelationship[] =>
  EDGE_REGISTRY.flatMap((edge) => {
    const relationships: AllowedAnonymousRelationship[] = [];

    if (endpointCanMatch(edge.fromNodeType, nodeType)) {
      if (isNodeType(edge.toNodeType)) {
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

    if (endpointCanMatch(edge.toNodeType, nodeType)) {
      if (isNodeType(edge.fromNodeType)) {
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

const relationshipKey = (relationship: AllowedAnonymousRelationship): string =>
  `${relationship.edgeType}\u0000${relationship.direction}\u0000${relationship.otherNodeType}`;

export const assertAnonymityRegistry = (): void => {
  const protectedNodeTypes = NODE_REGISTRY.filter(({ nodeType }) =>
    isAnonymityProtectedNodeType(nodeType),
  ).map(({ nodeType }) => nodeType);

  const registeredNodeTypes = new Set<NodeType>(
    ANONYMITY_REGISTRY.map(({ nodeType }) => nodeType),
  );

  if (
    protectedNodeTypes.length !== registeredNodeTypes.size ||
    protectedNodeTypes.some((nodeType) => !registeredNodeTypes.has(nodeType))
  ) {
    throw new Error(
      "Every anonymity-protected node must have one explicit anonymity registration",
    );
  }

  for (const registration of ANONYMITY_REGISTRY) {
    const expected = registration.allowedRelationships.map(relationshipKey).sort();
    const actual = actualRelationships(registration.nodeType)
      .map(relationshipKey)
      .sort();

    if (expected.join("\n") !== actual.join("\n")) {
      throw new Error(
        `Anonymity relationship mismatch for ${registration.nodeType}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
      );
    }
  }
};
