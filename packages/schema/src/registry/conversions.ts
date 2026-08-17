import { assertRegisteredRelationship, type EdgeType } from "./edges.js";
import { getNodeRegistration, type NodeType } from "./nodes.js";

export interface ConversionRegistration {
  readonly sourceNodeType: NodeType;
  readonly destinationNodeType: NodeType;
  readonly sourceTerminalStatus: string;
  readonly edge: {
    readonly edgeType: EdgeType;
    readonly fromNodeType: NodeType;
    readonly toNodeType: NodeType;
  };
}

export const CONVERSION_REGISTRY = [
  {
    sourceNodeType: "Candidate",
    destinationNodeType: "Employee",
    sourceTerminalStatus: "Converted",
    edge: {
      edgeType: "converted_from",
      fromNodeType: "Employee",
      toNodeType: "Candidate",
    },
  },
  {
    sourceNodeType: "GhostResource",
    destinationNodeType: "Employee",
    sourceTerminalStatus: "Promoted",
    edge: {
      edgeType: "promoted_to",
      fromNodeType: "GhostResource",
      toNodeType: "Employee",
    },
  },
  {
    sourceNodeType: "Pitch",
    destinationNodeType: "Project",
    sourceTerminalStatus: "Converted",
    edge: {
      edgeType: "originated_from",
      fromNodeType: "Project",
      toNodeType: "Pitch",
    },
  },
] as const satisfies readonly ConversionRegistration[];

export const assertConversionRegistrations = (): void => {
  for (const conversion of CONVERSION_REGISTRY) {
    const source = getNodeRegistration(conversion.sourceNodeType);

    if (
      source.lifecycle.kind !== "fixed" ||
      !source.lifecycle.statuses.includes(conversion.sourceTerminalStatus)
    ) {
      throw new Error(
        `Conversion terminal status is not registered on ${conversion.sourceNodeType}: ${conversion.sourceTerminalStatus}`,
      );
    }

    assertRegisteredRelationship(
      conversion.edge.edgeType,
      conversion.edge.fromNodeType,
      conversion.edge.toNodeType,
    );

    const endpointTypes = new Set<NodeType>([
      conversion.edge.fromNodeType,
      conversion.edge.toNodeType,
    ]);

    if (
      !endpointTypes.has(conversion.sourceNodeType) ||
      !endpointTypes.has(conversion.destinationNodeType)
    ) {
      throw new Error(
        `Conversion edge does not connect ${conversion.sourceNodeType} and ${conversion.destinationNodeType}`,
      );
    }
  }
};
