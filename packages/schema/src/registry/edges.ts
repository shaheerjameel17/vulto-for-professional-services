import {
  getNodeRegistration,
  isAnonymityProtectedNodeType,
  type NodeType,
} from "./nodes";

export const NON_ANONYMOUS_NODE = "Any non-anonymity-protected node" as const;
export const MENTIONABLE_NODE = "Mentionable Node" as const;
export const CUSTOM_FIELD_ENABLED_NODE = "Custom-field-enabled Node" as const;
export const IMPORTABLE_NODE = "Importable Node" as const;

export const ENDPOINT_SETS = [
  NON_ANONYMOUS_NODE,
  MENTIONABLE_NODE,
  CUSTOM_FIELD_ENABLED_NODE,
  IMPORTABLE_NODE,
] as const;

export type EndpointSet = (typeof ENDPOINT_SETS)[number];
export type RegistryEndpoint = NodeType | EndpointSet;

type EndpointPair = readonly [from: RegistryEndpoint, to: RegistryEndpoint];

interface EdgeGroupShape {
  readonly edgeType: string;
  readonly owner: string;
  readonly pairs: readonly EndpointPair[];
  readonly sourceRows?: number;
  readonly historyPolicy?: "single-active-outgoing";
  /**
   * F136 / FDN-92. For an endpoint node type that has more than one privacy
   * partition (`getProtectionPartitions(nodeType).length > 1`), the partition
   * whose write-permission column governs an edge write on this edge type.
   *
   * Keyed by node type, not by from/to position, so a polymorphic edge — or
   * an endpoint-set position that resolves to several concrete types — can
   * name a partition per split type it connects. Consulted ONLY for a split
   * endpoint; a single-partition endpoint ignores it entirely. A split
   * endpoint with no entry here resolves to `none` in `authorizeEdgeWrite`
   * (the conservative F136 default is the fallback for anything the registry
   * has not reviewed). It is NEVER supplied by a write delta — a
   * self-declared scope would be a bypass; `authorizeEdgeWrite` looks this up
   * independently.
   */
  readonly governingPartitions?: Readonly<Partial<Record<NodeType, string>>>;
}

const edgeGroup = <const T extends EdgeGroupShape>(group: T): T => group;

/**
 * Source groups preserve VPS-A002's ownership and notes while making every
 * endpoint pairing explicit. `pairs` is never interpreted as a Cartesian
 * product: each tuple is one canonical relationship registration.
 */
export const EDGE_GROUPS = [
  // Identity and structure.
  edgeGroup({
    edgeType: "membership_of",
    owner: "VPS-A002",
    pairs: [["WorkspaceMembership", "User"]],
  }),
  edgeGroup({
    edgeType: "membership_in",
    owner: "VPS-A002",
    pairs: [["WorkspaceMembership", "Workspace"]],
    // Membership is a display/identity fact about the workspace; the split
    // Workspace endpoint's `billing` partition (Tier 2) governs financial
    // configuration, not who belongs. F136 / FDN-92, founder-approved.
    governingPartitions: { Workspace: "display" },
  }),
  edgeGroup({
    edgeType: "registered_on",
    owner: "VPS-A002",
    pairs: [["Device", "User"]],
  }),
  edgeGroup({
    edgeType: "managed_by",
    owner: "VPS-A002",
    historyPolicy: "single-active-outgoing",
    pairs: [["Employee", "Employee"]],
  }),
  edgeGroup({
    edgeType: "scoped_to_entity",
    owner: "VRS-F003",
    historyPolicy: "single-active-outgoing",
    pairs: [["Employee", "Entity"]],
  }),
  edgeGroup({
    edgeType: "governed_by_calendar",
    owner: "VRS-F004",
    pairs: [["Entity", "WorkingCalendar"]],
  }),
  edgeGroup({
    edgeType: "pattern_for",
    owner: "VRS-F004",
    pairs: [["WorkingPattern", "Employee"]],
  }),
  edgeGroup({
    edgeType: "holiday_in",
    owner: "VRS-F004",
    pairs: [["Holiday", "WorkingCalendar"]],
  }),
  edgeGroup({
    edgeType: "delivered_to",
    owner: "VPS-F003",
    pairs: [["Notification", "User"]],
  }),

  // Capacity and delivery.
  edgeGroup({
    edgeType: "assignment_of",
    owner: "VRS-F005",
    pairs: [["Assignment", "Employee"]],
    // Which person an assignment is for is staffing/operational data. F136 /
    // FDN-92, founder-approved.
    governingPartitions: { Employee: "operational" },
  }),
  edgeGroup({
    edgeType: "assigned_to",
    owner: "VRS-F005",
    pairs: [["Assignment", "Project"]],
  }),
  edgeGroup({
    edgeType: "belongs_to",
    owner: "VPS-A002",
    pairs: [["Project", "Client"]],
  }),
  edgeGroup({
    edgeType: "originated_from",
    owner: "VPS-A002",
    pairs: [["Project", "Pitch"]],
  }),
  edgeGroup({
    edgeType: "placeholder_for",
    owner: "VPS-A002",
    pairs: [["GhostResource", "OpenRole"]],
  }),
  edgeGroup({
    edgeType: "promoted_to",
    owner: "VPS-A002",
    pairs: [["GhostResource", "Employee"]],
  }),
  edgeGroup({
    edgeType: "logged_against",
    owner: "VRS-F010",
    pairs: [
      ["TimesheetEntry", "Assignment"],
      ["TimesheetEntry", "Pitch"],
    ],
  }),
  edgeGroup({
    edgeType: "processed_in",
    owner: "VRS-F062; VRS-F067",
    pairs: [
      ["TimesheetEntry", "PayRun"],
      ["TimesheetEntry", "Invoice"],
    ],
  }),
  edgeGroup({
    edgeType: "contracted_with",
    owner: "VRS-F043",
    pairs: [["SubVendor", "Project"]],
  }),

  // Skills.
  edgeGroup({
    edgeType: "has_skill",
    owner: "VPS-A002",
    pairs: [["Employee", "Skill"]],
    // A skill holding is operational HR data; requiring compensation-level
    // (finance) permission to record one is wrong for the product. F136 /
    // FDN-92, founder-approved.
    governingPartitions: { Employee: "operational" },
  }),
  edgeGroup({
    edgeType: "requires_skill",
    owner: "VPS-A002",
    pairs: [
      ["Project", "Skill"],
      ["OpenRole", "Skill"],
      ["Pitch", "Skill"],
      ["CareerMilestone", "Skill"],
      ["Requisition", "Skill"],
    ],
  }),
  edgeGroup({
    edgeType: "holds_certification",
    owner: "VRS-F041",
    pairs: [["Employee", "Certification"]],
    // Certifications are operational, not compensation. F136 / FDN-92,
    // founder-approved.
    governingPartitions: { Employee: "operational" },
  }),
  edgeGroup({
    edgeType: "resulted_in",
    owner: "VRS-F041",
    pairs: [["TrainingRecord", "Skill"]],
  }),
  edgeGroup({
    edgeType: "gap_for",
    owner: "VRS-F013",
    pairs: [["SkillGap", "Skill"]],
  }),

  // Recruitment.
  edgeGroup({
    edgeType: "converted_from",
    owner: "VPS-A002",
    pairs: [["Employee", "Candidate"]],
  }),
  edgeGroup({
    edgeType: "filled_by",
    owner: "VPS-A002",
    pairs: [["OpenRole", "Candidate"]],
  }),
  edgeGroup({
    edgeType: "requisition_for",
    owner: "VRS-F027",
    pairs: [["Requisition", "HeadcountPlan"]],
  }),
  edgeGroup({
    edgeType: "opened_from",
    owner: "VRS-F027",
    pairs: [["OpenRole", "Requisition"]],
  }),
  edgeGroup({
    edgeType: "posted_as",
    owner: "VRS-F029",
    pairs: [["OpenRole", "JobPosting"]],
  }),
  edgeGroup({
    edgeType: "pooled_in",
    owner: "VRS-F033",
    pairs: [["Candidate", "TalentPool"]],
  }),
  edgeGroup({
    edgeType: "referred_by",
    owner: "VRS-F034",
    pairs: [["Referral", "Employee"]],
  }),
  edgeGroup({
    edgeType: "referral_for",
    owner: "VRS-F034",
    pairs: [["Referral", "Candidate"]],
  }),
  edgeGroup({
    edgeType: "interview_for",
    owner: "VRS-F031",
    pairs: [["InterviewRound", "Candidate"]],
  }),
  edgeGroup({
    edgeType: "participating_in",
    owner: "VRS-F031",
    pairs: [["Employee", "InterviewRound"]],
  }),
  edgeGroup({
    edgeType: "has_feedback",
    owner: "VRS-F031",
    pairs: [["InterviewRound", "FeedbackEntry"]],
  }),
  edgeGroup({
    edgeType: "offer_for",
    owner: "VRS-F032",
    pairs: [["Offer", "Candidate"]],
  }),
  edgeGroup({
    edgeType: "check_for",
    owner: "VRS-F035",
    pairs: [["BackgroundCheckRecord", "Candidate"]],
  }),

  // HR operations.
  edgeGroup({
    edgeType: "employed_under",
    owner: "VRS-F020",
    pairs: [["Employee", "Contract"]],
  }),
  edgeGroup({
    edgeType: "signature_for",
    owner: "VRS-F021",
    pairs: [["SignatureRequest", "Contract"]],
  }),
  edgeGroup({
    edgeType: "has_document",
    owner: "VRS-F022",
    pairs: [
      ["Contract", "Document"],
      ["Offer", "Document"],
      ["HRCase", "Document"],
      ["WorkAuthorization", "Document"],
      ["BackgroundCheckRecord", "Document"],
      ["PaySlip", "Document"],
    ],
  }),
  edgeGroup({
    edgeType: "requested_by",
    owner: "VRS-F019",
    pairs: [["LeaveRequest", "Employee"]],
  }),
  edgeGroup({
    edgeType: "approved_by",
    owner: "VRS-F019",
    pairs: [["LeaveRequest", "Employee"]],
  }),
  edgeGroup({
    edgeType: "allocated_to",
    owner: "VRS-F042",
    pairs: [["Asset", "Employee"]],
  }),
  edgeGroup({
    edgeType: "departing",
    owner: "VRS-F023",
    pairs: [["Departure", "Employee"]],
  }),
  edgeGroup({
    edgeType: "enrolled_in",
    owner: "VRS-F024",
    pairs: [["Employee", "OnboardingPlan"]],
  }),
  edgeGroup({
    edgeType: "acknowledged_by",
    owner: "VRS-F044",
    pairs: [["PolicyAcknowledgment", "Employee"]],
  }),
  edgeGroup({
    edgeType: "acknowledgment_of",
    owner: "VRS-F044",
    pairs: [["PolicyAcknowledgment", "Policy"]],
  }),
  edgeGroup({
    edgeType: "authorization_for",
    owner: "VRS-F045",
    pairs: [["WorkAuthorization", "Employee"]],
  }),
  edgeGroup({
    edgeType: "case_concerns",
    owner: "VRS-F046",
    pairs: [["HRCase", "Employee"]],
  }),
  edgeGroup({
    edgeType: "event_in",
    owner: "VRS-F046",
    pairs: [["CaseEvent", "HRCase"]],
  }),
  edgeGroup({
    edgeType: "scenario_of",
    owner: "VRS-F037",
    pairs: [["OrgScenario", "Workspace"]],
  }),

  // Development and signals.
  edgeGroup({
    edgeType: "reviewed_in",
    owner: "VRS-F039",
    pairs: [["Employee", "ReviewEntry"]],
  }),
  edgeGroup({
    edgeType: "part_of",
    owner: "VRS-F039; VRS-F048",
    sourceRows: 2,
    pairs: [
      ["ReviewEntry", "ReviewCycle"],
      ["PulseEntry", "PulseCycle"],
      ["PulseAggregateContribution", "PulseCycle"],
    ],
  }),
  edgeGroup({
    edgeType: "at_milestone",
    owner: "VRS-F040",
    pairs: [["Employee", "CareerMilestone"]],
  }),
  edgeGroup({
    edgeType: "targeting",
    owner: "VRS-F040",
    pairs: [["Employee", "CareerMilestone"]],
  }),
  edgeGroup({
    edgeType: "working_towards",
    owner: "VRS-F040",
    pairs: [["Employee", "DevelopmentGoal"]],
  }),
  edgeGroup({
    edgeType: "submitted_by",
    owner: "VRS-F048; VRS-F077",
    pairs: [
      ["PulseEntry", "Employee"],
      ["CoffeePulseEntry", "Employee"],
    ],
  }),
  edgeGroup({
    edgeType: "logged_by",
    owner: "VRS-F078",
    pairs: [["WellnessTriggerEvent", "Employee"]],
  }),
  edgeGroup({
    edgeType: "checked_in_on",
    owner: "VRS-F057",
    pairs: [["ProbationCheckIn", "Employee"]],
  }),
  edgeGroup({
    edgeType: "triggered_by",
    owner: "VRS-F052; VRS-F053; VRS-F012; VRS-F010",
    pairs: [
      ["BurnoutAlert", "Employee"],
      ["FlightRiskSignal", "Employee"],
      ["RevenueGapAlert", "Employee"],
      ["TimesheetAnomalyFlag", "Employee"],
    ],
  }),
  edgeGroup({
    edgeType: "affects",
    owner: "VRS-F055",
    pairs: [["Insight", NON_ANONYMOUS_NODE]],
  }),

  // Finance.
  edgeGroup({
    edgeType: "governed_by",
    owner: "VRS-F006; VRS-F018; VRS-F062; VRS-F063",
    sourceRows: 4,
    pairs: [
      ["Assignment", "RateCard"],
      ["Employee", "LeavePolicy"],
      ["PayRun", "PayrollPolicy"],
      ["PayRun", "TaxConfig"],
    ],
  }),
  edgeGroup({
    edgeType: "banded_by",
    owner: "VRS-F070",
    pairs: [["Employee", "CompensationBand"]],
  }),
  edgeGroup({
    edgeType: "changes_compensation_for",
    owner: "VRS-F038",
    pairs: [["CompensationChange", "Employee"]],
  }),
  edgeGroup({
    edgeType: "gated_by",
    owner: "VRS-F065",
    pairs: [
      ["PayRun", "ApprovalStage"],
      ["CompensationChange", "ApprovalStage"],
      ["Requisition", "ApprovalStage"],
      ["Offer", "ApprovalStage"],
    ],
  }),
  edgeGroup({
    edgeType: "contains",
    owner: "VRS-F062",
    pairs: [["PayRun", "PaySlip"]],
  }),
  edgeGroup({
    edgeType: "issued_to",
    owner: "VRS-F062",
    pairs: [["PaySlip", "Employee"]],
  }),
  edgeGroup({
    edgeType: "disbursed_in",
    owner: "VRS-F066",
    pairs: [
      ["PaySlip", "DisbursementBatch"],
      ["Invoice", "DisbursementBatch"],
    ],
  }),
  edgeGroup({
    edgeType: "instruction_in",
    owner: "VRS-F066",
    pairs: [["DisbursementInstruction", "DisbursementBatch"]],
  }),
  edgeGroup({
    edgeType: "billed_by",
    owner: "VRS-F067",
    pairs: [
      ["Invoice", "Employee"],
      ["Invoice", "SubVendor"],
    ],
  }),
  edgeGroup({
    edgeType: "generated_from",
    owner: "VRS-F067",
    pairs: [["Invoice", "Project"]],
  }),
  edgeGroup({
    edgeType: "incurred_by",
    owner: "VRS-F068",
    pairs: [["Expense", "Employee"]],
  }),
  edgeGroup({
    edgeType: "attributed_to",
    owner: "VRS-F068",
    pairs: [["Expense", "Project"]],
  }),

  // Platform.
  edgeGroup({
    edgeType: "supersedes",
    owner: "VPS-A002",
    pairs: [
      ["RateCard", "RateCard"],
      ["LeavePolicy", "LeavePolicy"],
      ["TaxConfig", "TaxConfig"],
      ["Policy", "Policy"],
      ["WorkingCalendar", "WorkingCalendar"],
      ["CompensationBand", "CompensationBand"],
    ],
  }),
  edgeGroup({
    edgeType: "references",
    owner: "VPS-A005",
    pairs: [["GraphReference", MENTIONABLE_NODE]],
  }),
  edgeGroup({
    edgeType: "referenced_in",
    owner: "VPS-A005",
    pairs: [[MENTIONABLE_NODE, "GraphReference"]],
  }),
  edgeGroup({
    edgeType: "has_custom_value",
    owner: "VPS-F010",
    pairs: [[CUSTOM_FIELD_ENABLED_NODE, "CustomFieldValue"]],
  }),
  edgeGroup({
    edgeType: "defined_by",
    owner: "VPS-F010",
    pairs: [["CustomFieldValue", "CustomFieldDefinition"]],
  }),
  edgeGroup({
    edgeType: "imported_in",
    owner: "VPS-F006",
    pairs: [[IMPORTABLE_NODE, "ImportBatch"]],
  }),
  edgeGroup({
    edgeType: "erasure_targets",
    owner: "VPS-F007",
    pairs: [
      ["ErasureRequest", "Employee"],
      ["ErasureRequest", "Candidate"],
    ],
  }),
] as const satisfies readonly EdgeGroupShape[];

export type EdgeType = (typeof EDGE_GROUPS)[number]["edgeType"];

export interface EdgeRegistration {
  readonly edgeType: EdgeType;
  readonly fromNodeType: RegistryEndpoint;
  readonly toNodeType: RegistryEndpoint;
  readonly owner: string;
  readonly historyPolicy: "single-active-outgoing" | "none-specified";
  /** `{}` when the edge group declares none. See `EdgeGroupShape`. */
  readonly governingPartitions: Readonly<Partial<Record<NodeType, string>>>;
}

export const EDGE_TYPES = EDGE_GROUPS.map(
  ({ edgeType }) => edgeType,
) as readonly EdgeType[];

export const EDGE_SOURCE_ROW_COUNT = EDGE_GROUPS.reduce(
  (count, group) => count + ("sourceRows" in group ? group.sourceRows : 1),
  0,
);

export const EDGE_REGISTRY: readonly EdgeRegistration[] = EDGE_GROUPS.flatMap((group) =>
  group.pairs.map(([fromNodeType, toNodeType]) => ({
    edgeType: group.edgeType,
    fromNodeType,
    toNodeType,
    owner: group.owner,
    historyPolicy: "historyPolicy" in group ? group.historyPolicy : "none-specified",
    governingPartitions:
      "governingPartitions" in group ? group.governingPartitions : {},
  })),
);

const relationshipKey = (
  edgeType: EdgeType,
  fromNodeType: RegistryEndpoint,
  toNodeType: RegistryEndpoint,
): string => `${edgeType}\u0000${fromNodeType}\u0000${toNodeType}`;

const edgeRegistryByKey = new Map(
  EDGE_REGISTRY.map((registration) => [
    relationshipKey(
      registration.edgeType,
      registration.fromNodeType,
      registration.toNodeType,
    ),
    registration,
  ]),
);

const CUSTOM_FIELD_ENABLED_NODE_TYPES = new Set<NodeType>([
  "Employee",
  "Project",
  "Client",
  "Candidate",
  "Assignment",
  "OpenRole",
  "SubVendor",
]);

const IMPORTABLE_NODE_TYPES = new Set<NodeType>([
  "Employee",
  "Assignment",
  "Project",
  "Client",
  "Skill",
]);

const isMentionableNodeType = (nodeType: NodeType): boolean => {
  const protection = getNodeRegistration(nodeType).protection;

  return (
    (protection.kind === "fixed" && protection.tier === 0) ||
    (protection.kind === "split" &&
      protection.partitions.some(({ tier }) => tier === 0))
  );
};

export const matchesRegistryEndpoint = (
  registered: RegistryEndpoint,
  actual: NodeType,
): boolean => {
  if (registered === actual) {
    return true;
  }

  // F90: endpoint sets never include an anonymity-protected node. Every
  // permitted connection for such a node must name it in an exact triple.
  if (isAnonymityProtectedNodeType(actual)) {
    return false;
  }

  switch (registered) {
    case NON_ANONYMOUS_NODE:
      return true;
    case MENTIONABLE_NODE:
      return isMentionableNodeType(actual);
    case CUSTOM_FIELD_ENABLED_NODE:
      return CUSTOM_FIELD_ENABLED_NODE_TYPES.has(actual);
    case IMPORTABLE_NODE:
      return IMPORTABLE_NODE_TYPES.has(actual);
    default:
      return false;
  }
};

export const getEdgeRegistrations = (edgeType: EdgeType): readonly EdgeRegistration[] =>
  EDGE_REGISTRY.filter((registration) => registration.edgeType === edgeType);

export const assertRegisteredRelationship = (
  edgeType: EdgeType,
  fromNodeType: NodeType,
  toNodeType: NodeType,
): EdgeRegistration => {
  const registration = EDGE_REGISTRY.find(
    (candidate) =>
      candidate.edgeType === edgeType &&
      matchesRegistryEndpoint(candidate.fromNodeType, fromNodeType) &&
      matchesRegistryEndpoint(candidate.toNodeType, toNodeType),
  );

  if (registration === undefined) {
    throw new Error(
      `Unregistered relationship: ${edgeType} (${fromNodeType} -> ${toNodeType})`,
    );
  }

  return registration;
};

export const hasExactRelationshipRegistration = (
  edgeType: EdgeType,
  fromNodeType: RegistryEndpoint,
  toNodeType: RegistryEndpoint,
): boolean =>
  edgeRegistryByKey.has(relationshipKey(edgeType, fromNodeType, toNodeType));
