import type { EdgeType } from "./edges";
import type { NodeType } from "./nodes";

export interface ParticipantGrant {
  readonly viaEdgeType: EdgeType;
  readonly fromNodeType: NodeType;
  readonly outcome: "read" | "full";
}

export const PARTICIPANT_GRANTS: Readonly<Partial<Record<NodeType, ParticipantGrant>>> =
  {
    Pitch: { viaEdgeType: "staffed_on", fromNodeType: "Employee", outcome: "read" },
  };
