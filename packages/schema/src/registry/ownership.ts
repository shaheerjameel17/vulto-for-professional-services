import { type NodeType } from "./nodes.js";

export type OwnershipMode = "permanent" | "activation-handoff" | "concurrent";

export interface OwnershipRegistration {
  readonly nodeTypes: readonly NodeType[];
  readonly mode: OwnershipMode;
  readonly authoritativeOwner: string;
  readonly readers: readonly string[];
  readonly writePolicy: string;
}

export const OWNERSHIP_REGISTRY = [
  {
    nodeTypes: ["Employee", "Assignment", "Entity"],
    mode: "permanent",
    authoritativeOwner: "Vulto Roster",
    readers: [
      "Vulto Projects",
      "Vulto Accounts",
      "Vulto Payroll",
      "Vulto Legal",
      "Vulto Network",
    ],
    writePolicy: "Vulto Roster only",
  },
  {
    nodeTypes: ["WorkingCalendar", "Holiday", "WorkingPattern"],
    mode: "permanent",
    authoritativeOwner: "Vulto Roster",
    readers: ["Vulto Projects", "Vulto Payroll", "Vulto Accounts"],
    writePolicy: "Vulto Roster only",
  },
  {
    nodeTypes: ["Client"],
    mode: "activation-handoff",
    authoritativeOwner: "Vulto Sales",
    readers: [
      "Vulto Roster",
      "Vulto Projects",
      "Vulto Accounts",
      "Vulto Legal",
      "Vulto Pitch",
    ],
    writePolicy:
      "Vulto Projects writes until Vulto Sales activates; Vulto Sales thereafter",
  },
  {
    nodeTypes: ["Project"],
    mode: "concurrent",
    authoritativeOwner: "Vulto Projects once activated",
    readers: ["Vulto Roster", "Vulto Accounts", "Vulto Legal", "Vulto Pitch"],
    writePolicy:
      "Vulto Projects owns lifecycle after activation; Vulto Roster writes capacity fields only",
  },
  {
    nodeTypes: ["TimesheetEntry"],
    mode: "concurrent",
    authoritativeOwner: "Vulto Roster bootstrap",
    readers: ["Vulto Projects", "Vulto Accounts"],
    writePolicy:
      "Vulto Projects becomes primary after activation; Roster Speed-Run remains available",
  },
  {
    nodeTypes: ["Contract"],
    mode: "activation-handoff",
    authoritativeOwner: "Vulto Legal once activated",
    readers: ["Vulto Legal"],
    writePolicy:
      "Vulto Roster writes until Legal activates; Legal owns signature and archival status from creation",
  },
  {
    nodeTypes: ["RateCard", "Invoice"],
    mode: "activation-handoff",
    authoritativeOwner: "Vulto Accounts",
    readers: ["Vulto Roster", "Vulto Accounts", "Vulto Quotations", "Vulto Pitch"],
    writePolicy:
      "Vulto Roster writes until Vulto Accounts activates; Vulto Accounts thereafter",
  },
  {
    nodeTypes: ["PayRun", "PaySlip", "DisbursementBatch"],
    mode: "activation-handoff",
    authoritativeOwner: "Vulto Payroll once activated",
    readers: ["Vulto Roster", "Vulto Accounts"],
    writePolicy:
      "Vulto Roster writes until Vulto Payroll activates; Vulto Payroll thereafter",
  },
  {
    nodeTypes: [
      "Deliverable",
      "Task",
      "Brief",
      "Approval",
      "RevisionRound",
      "ChangeOrder",
      "ProjectTemplate",
      "ClientStakeholder",
    ],
    mode: "permanent",
    authoritativeOwner: "Vulto Projects",
    readers: [
      "Vulto Roster",
      "Vulto Accounts",
      "Vulto Legal",
      "Vulto Pitch",
      "Vulto Reports",
    ],
    writePolicy: "Vulto Projects only",
  },
  {
    nodeTypes: ["BillingMilestone"],
    mode: "activation-handoff",
    authoritativeOwner: "Vulto Accounts",
    readers: ["Vulto Projects", "Vulto Accounts", "Vulto Quotations"],
    writePolicy:
      "Vulto Projects writes until Vulto Accounts activates; Vulto Accounts thereafter",
  },
] as const satisfies readonly OwnershipRegistration[];

const ownershipByNodeType = new Map<NodeType, OwnershipRegistration>(
  OWNERSHIP_REGISTRY.flatMap((registration) =>
    registration.nodeTypes.map((nodeType) => [nodeType, registration]),
  ),
);

export const getOwnershipRegistration = (
  nodeType: NodeType,
): OwnershipRegistration | undefined => ownershipByNodeType.get(nodeType);
