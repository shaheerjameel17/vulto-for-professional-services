import {
  featureOwnedLifecycle,
  fixedLifecycle,
  fixedProtection,
  inheritedProtection,
  splitProtection,
  type NodeRegistrationShape,
  type UniversalFieldPolicy,
} from "./types";

type NodeInput = Omit<NodeRegistrationShape, "universalFields">;

function registerNode<const T extends NodeInput>(
  registration: T,
): T & { readonly universalFields: "standard" };
function registerNode<const T extends NodeInput, const U extends UniversalFieldPolicy>(
  registration: T,
  universalFields: U,
): T & { readonly universalFields: U };
function registerNode(
  registration: NodeInput,
  universalFields: UniversalFieldPolicy = "standard",
): NodeRegistrationShape {
  return { ...registration, universalFields };
}

export const NODE_REGISTRY = [
  // Identity and workspace — A002-owned.
  registerNode({
    nodeType: "User",
    owner: "VPS-F001",
    lifecycle: fixedLifecycle("Active", "Suspended", "Deleted"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Workspace",
    owner: "VPS-F001",
    lifecycle: fixedLifecycle("Active", "Suspended", "Canceled"),
    protection: splitProtection(
      { key: "display", privacyClass: "Standard", tier: 0 },
      { key: "billing", privacyClass: "Owner only", tier: 2 },
    ),
  }),
  registerNode({
    nodeType: "WorkspaceMembership",
    owner: "VPS-F001",
    lifecycle: fixedLifecycle("Active", "Revoked"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Device",
    owner: "VPS-F001",
    lifecycle: fixedLifecycle("Active", "Revoked"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Entity",
    owner: "VRS-F003",
    lifecycle: fixedLifecycle("Active", "Dissolved"),
    protection: fixedProtection("Standard", 0),
  }),

  // Calendar and time — A002-owned.
  registerNode({
    nodeType: "WorkingCalendar",
    owner: "VRS-F004",
    lifecycle: fixedLifecycle("Active", "Superseded"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Holiday",
    owner: "VRS-F004",
    lifecycle: fixedLifecycle("Active", "Canceled"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "WorkingPattern",
    owner: "VRS-F004",
    lifecycle: fixedLifecycle("Active", "Superseded"),
    protection: fixedProtection("Standard", 0),
  }),

  // Core people and capacity — A002-owned.
  registerNode({
    nodeType: "Employee",
    owner: "VRS-F002",
    lifecycle: fixedLifecycle("Active", "Inactive", "Converted"),
    protection: splitProtection(
      { key: "operational", privacyClass: "Standard", tier: 0 },
      {
        key: "compensation",
        privacyClass: "Finance-restricted",
        tier: 1,
      },
    ),
  }),
  registerNode({
    nodeType: "Candidate",
    owner: "VRS-F028",
    lifecycle: fixedLifecycle("Active", "Hired", "Rejected", "Withdrawn", "Converted"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "GhostResource",
    owner: "VRS-F007",
    lifecycle: fixedLifecycle("Active", "Promoted", "Canceled"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Assignment",
    owner: "VRS-F005",
    lifecycle: fixedLifecycle("Active", "Completed", "Canceled"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Project",
    owner: "VRS-F005 bootstrap",
    lifecycle: fixedLifecycle("Pitch", "Active", "Completed", "Archived"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Pitch",
    owner: "VRS-F009",
    lifecycle: fixedLifecycle("Active", "Won", "Lost", "Converted"),
    protection: splitProtection(
      { key: "identifying", privacyClass: "Standard", tier: 0 },
      {
        key: "commercial",
        privacyClass: "Finance-restricted",
        tier: 1,
      },
    ),
  }),
  registerNode({
    nodeType: "Client",
    owner: "Vulto Sales permanent; VPJ-F001 bootstrap",
    lifecycle: fixedLifecycle("Active", "Inactive"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "OpenRole",
    owner: "VRS-F028",
    lifecycle: fixedLifecycle("Open", "Filled", "Canceled"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Skill",
    owner: "VRS-F013",
    lifecycle: fixedLifecycle("Active", "Deprecated"),
    protection: fixedProtection("Standard", 0),
  }),

  // Wellness — A002-owned.
  registerNode({
    nodeType: "WellnessTriggerEvent",
    owner: "VRS-F078",
    lifecycle: fixedLifecycle("Active", "Resolved"),
    protection: fixedProtection("Self-only, absolute", 3),
  }),

  // HR operations — field schema and lifecycle are feature-owned.
  registerNode({
    nodeType: "Contract",
    owner: "VRS-F020",
    lifecycle: featureOwnedLifecycle,
    protection: splitProtection(
      { key: "identifying", privacyClass: "HR-restricted", tier: 2 },
      { key: "content", privacyClass: "Finance-restricted", tier: 1 },
    ),
  }),
  registerNode({
    nodeType: "SignatureRequest",
    owner: "VRS-F021",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "Document",
    owner: "VRS-F022",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "LeavePolicy",
    owner: "VRS-F018",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "LeaveRequest",
    owner: "VRS-F019",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Departure",
    owner: "VRS-F023",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "Asset",
    owner: "VRS-F042",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Certification",
    owner: "VRS-F041",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "TrainingRecord",
    owner: "VRS-F041",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "SubVendor",
    owner: "VRS-F043",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Policy",
    owner: "VRS-F044",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "PolicyAcknowledgment",
    owner: "VRS-F044",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "WorkAuthorization",
    owner: "VRS-F045",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "HRCase",
    owner: "VRS-F046",
    lifecycle: featureOwnedLifecycle,
    protection: splitProtection(
      {
        key: "identifying",
        privacyClass: "Owner and HR Admin only",
        tier: 2,
      },
      {
        key: "content",
        privacyClass: "Owner and HR Admin only",
        tier: 1,
      },
    ),
  }),
  registerNode({
    nodeType: "CaseEvent",
    owner: "VRS-F046",
    lifecycle: featureOwnedLifecycle,
    protection: splitProtection(
      {
        key: "identifying",
        privacyClass: "Owner and HR Admin only",
        tier: 2,
      },
      {
        key: "content",
        privacyClass: "Owner and HR Admin only",
        tier: 1,
      },
    ),
  }),
  registerNode({
    nodeType: "OrgScenario",
    owner: "VRS-F037",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner and HR Admin only", 2),
  }),

  // Recruitment.
  registerNode({
    nodeType: "HeadcountPlan",
    owner: "VRS-F027",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "Requisition",
    owner: "VRS-F027",
    lifecycle: featureOwnedLifecycle,
    protection: splitProtection(
      { key: "identifying", privacyClass: "Standard", tier: 0 },
      { key: "budget", privacyClass: "Finance-restricted", tier: 1 },
    ),
  }),
  registerNode({
    nodeType: "JobPosting",
    owner: "VRS-F029",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "TalentPool",
    owner: "VRS-F033",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "Referral",
    owner: "VRS-F034",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "InterviewRound",
    owner: "VRS-F031",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "FeedbackEntry",
    owner: "VRS-F031",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "Offer",
    owner: "VRS-F032",
    lifecycle: featureOwnedLifecycle,
    protection: splitProtection(
      { key: "identifying", privacyClass: "HR-restricted", tier: 2 },
      { key: "terms", privacyClass: "Finance-restricted", tier: 1 },
    ),
  }),
  registerNode({
    nodeType: "BackgroundCheckProvider",
    owner: "VRS-F035",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR Admin only", 2),
  }),
  registerNode({
    nodeType: "BackgroundCheckRecord",
    owner: "VRS-F035",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR Admin only", 2),
  }),
  registerNode({
    nodeType: "DraftHiringRecord",
    owner: "VRS-F036",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),

  // Signals and sentiment.
  registerNode({
    nodeType: "TimesheetEntry",
    owner: "VRS-F010",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "TimesheetAnomalyFlag",
    owner: "VRS-F010",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Manager-restricted", 2),
  }),
  registerNode({
    nodeType: "UtilizationSnapshot",
    owner: "VRS-F011",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "RevenueGapAlert",
    owner: "VRS-F012",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "SkillGap",
    owner: "VRS-F013",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "PulseCycle",
    owner: "VRS-F048",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "PulseEntry",
    owner: "VRS-F048",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Sensitive", 3),
  }),
  registerNode(
    {
      nodeType: "PulseAggregateContribution",
      owner: "VRS-F048",
      lifecycle: featureOwnedLifecycle,
      protection: fixedProtection("Standard", 0),
    },
    "anonymous-contribution",
  ),
  registerNode({
    nodeType: "CoffeePulseEntry",
    owner: "VRS-F077",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Sensitive", 3),
  }),
  registerNode({
    nodeType: "SharedCoffeeMoment",
    owner: "VRS-F077",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode(
    {
      nodeType: "WellnessAggregateContribution",
      owner: "VRS-F078",
      lifecycle: featureOwnedLifecycle,
      protection: fixedProtection("Standard", 0),
    },
    "anonymous-contribution",
  ),
  registerNode({
    nodeType: "BurnoutAlert",
    owner: "VRS-F052",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Manager-restricted", 2),
  }),
  registerNode({
    nodeType: "FlightRiskSignal",
    owner: "VRS-F053",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner and HR Admin only", 2),
  }),
  registerNode({
    nodeType: "ProbationCheckIn",
    owner: "VRS-F057",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Manager-restricted", 2),
  }),
  registerNode({
    nodeType: "HeadcountSnapshot",
    owner: "VRS-F058",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection(
      "HR-restricted",
      0,
      "Aggregate headcount contains no person-level payload.",
    ),
  }),

  // Finance.
  registerNode({
    nodeType: "RateCard",
    owner: "VRS-F006 bootstrap",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "RateCardLine",
    owner: "VRS-F006",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "CompensationBand",
    owner: "VRS-F070",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "CompensationChange",
    owner: "VRS-F038",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "PayrollPolicy",
    owner: "VRS-F062",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "PayRun",
    owner: "VRS-F062 bootstrap",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "PaySlip",
    owner: "VRS-F062",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Self and Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "TaxConfig",
    owner: "VRS-F063",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "ExchangeRate",
    owner: "VRS-F064",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "ApprovalStage",
    owner: "VRS-F065",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "DisbursementBatch",
    owner: "VRS-F066",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "DisbursementInstruction",
    owner: "VRS-F066",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "Invoice",
    owner: "VRS-F067 bootstrap",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "Expense",
    owner: "VRS-F068",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),

  // Development and review.
  registerNode({
    nodeType: "OnboardingTemplate",
    owner: "VRS-F024",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "OnboardingPlan",
    owner: "VRS-F024",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "OnboardingTask",
    owner: "VRS-F024",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ReviewCycle",
    owner: "VRS-F039",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ReviewEntry",
    owner: "VRS-F039",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR-restricted", 2),
  }),
  registerNode({
    nodeType: "CareerPath",
    owner: "VRS-F040",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "CareerMilestone",
    owner: "VRS-F040",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "DevelopmentGoal",
    owner: "VRS-F040",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),

  // Platform, intelligence and ecosystem.
  registerNode({
    nodeType: "Notification",
    owner: "VPS-F003",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Recipient-only", 0),
  }),
  registerNode(
    {
      nodeType: "AuditEntry",
      owner: "VPS-F004",
      lifecycle: featureOwnedLifecycle,
      protection: fixedProtection("Owner and HR Admin only", 2),
    },
    "immutable-audit",
  ),
  registerNode({
    nodeType: "ImportBatch",
    owner: "VPS-F006",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner and HR Admin only", 2),
  }),
  registerNode({
    nodeType: "RetentionPolicy",
    owner: "VPS-F007",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner and HR Admin only", 2),
  }),
  registerNode({
    nodeType: "ErasureRequest",
    owner: "VPS-F007",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner and HR Admin only", 2),
  }),
  registerNode({
    nodeType: "Insight",
    owner: "VRS-F055",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "BriefingNode",
    owner: "VRS-F056",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Self only", 0),
  }),
  registerNode({
    nodeType: "ReportDefinition",
    owner: "VRS-F061",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ReportRun",
    owner: "VRS-F061",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "BenchmarkRange",
    owner: "VRS-F071",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "BenchmarkReference",
    owner: "VRS-F072",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ApplicationActivation",
    owner: "VPS-F008",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "IntegrationConfig",
    owner: "VPS-F009",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Owner only", 2),
  }),
  registerNode({
    nodeType: "CustomFieldDefinition",
    owner: "VPS-F010",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "CustomFieldValue",
    owner: "VPS-F010",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "GraphReference",
    owner: "VPS-A005",
    lifecycle: featureOwnedLifecycle,
    protection: inheritedProtection,
  }),
  registerNode({
    nodeType: "ClientPortalAccess",
    owner: "Vulto Comms",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("HR Admin only", 2),
  }),

  // Vulto Projects — A002-owned lifecycle policies.
  registerNode({
    nodeType: "Deliverable",
    owner: "VPJ-F003",
    lifecycle: fixedLifecycle(
      "Draft",
      "InProgress",
      "InReview",
      "RevisionRequested",
      "Approved",
      "Canceled",
    ),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Task",
    owner: "VPJ-F004",
    lifecycle: fixedLifecycle("Todo", "InProgress", "Done", "Canceled"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Brief",
    owner: "VPJ-F005",
    lifecycle: fixedLifecycle("Draft", "Agreed", "Superseded"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "Approval",
    owner: "VPJ-F010",
    lifecycle: fixedLifecycle("Pending", "Approved", "RevisionRequested"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "RevisionRound",
    owner: "VPJ-F012",
    lifecycle: fixedLifecycle("Open", "Closed"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ChangeOrder",
    owner: "VPJ-F013",
    lifecycle: fixedLifecycle("Draft", "Sent", "Accepted", "Rejected"),
    protection: splitProtection(
      { key: "identifying", privacyClass: "Standard", tier: 0 },
      {
        key: "commercial",
        privacyClass: "Finance-restricted",
        tier: 1,
      },
    ),
  }),
  registerNode({
    nodeType: "ProjectBudget",
    owner: "VPJ-F014",
    lifecycle: fixedLifecycle("Active", "Superseded"),
    protection: fixedProtection("Finance-restricted", 1),
  }),
  registerNode({
    nodeType: "ProjectTemplate",
    owner: "VPJ-F016",
    lifecycle: fixedLifecycle("Active", "Archived"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "ClientStakeholder",
    owner: "VPJ-F018",
    lifecycle: fixedLifecycle("Active", "Inactive"),
    protection: fixedProtection("Standard", 0),
  }),
  registerNode({
    nodeType: "BillingMilestone",
    owner: "VPJ-F042 bootstrap; Vulto Accounts permanent",
    lifecycle: fixedLifecycle("Pending", "Triggered", "Invoiced"),
    protection: fixedProtection("Finance-restricted", 1),
  }),
] as const satisfies readonly NodeRegistrationShape[];

export type NodeRegistration = (typeof NODE_REGISTRY)[number];
export type NodeType = NodeRegistration["nodeType"];

export const NODE_TYPES = NODE_REGISTRY.map(
  ({ nodeType }) => nodeType,
) as readonly NodeType[];

const nodeRegistryByType = new Map<NodeType, NodeRegistration>(
  NODE_REGISTRY.map((registration) => [registration.nodeType, registration]),
);

export const getNodeRegistration = (nodeType: NodeType): NodeRegistration => {
  const registration = nodeRegistryByType.get(nodeType);

  if (registration === undefined) {
    throw new Error(`Unregistered node type: ${nodeType}`);
  }

  return registration;
};

export const isNodeType = (value: string): value is NodeType =>
  nodeRegistryByType.has(value as NodeType);

export const isAnonymityProtectedNodeType = (nodeType: NodeType): boolean =>
  getNodeRegistration(nodeType).universalFields === "anonymous-contribution";
