import { getNodeRegistration, type NodeType, type PrivacyClass } from "@vulto/schema";

/**
 * FDN-53 stage 1. The graph permission layer's policy table, per
 * `VPS-A004_Graph_Permission_Layer`.
 *
 * This module is data, not logic: the default class-to-permission mapping
 * and the node-type matrix are transcribed here as typed tables, and
 * `resolvePermission` is a pure lookup over them plus A004-T08's fallback.
 * Nothing here inspects a node instance, a query result, or received data —
 * per A004-T19 and this stage's own scope, a `Restricted` render must be
 * derivable from schema knowledge alone.
 *
 * **What this stage resolves, precisely.** `VPS-A004`'s matrix cells are not
 * all bare role grants — most carry a qualifier ("Full (direct reports)",
 * "Read (own only)", "Full (own + team)", "Read (pipeline)", and so on).
 * Resolving a qualifier requires row-level identity: is THIS record the
 * caller's own, is THIS employee a direct report of the caller, is the
 * caller a participant on THIS interview round. That identity does not
 * exist yet in this codebase — there is no User-to-Employee linkage until
 * `VRS-F002` (Atomic Employee Profiles) is implemented, and `VRS-F002` is
 * explicitly out of scope for this phase per `CLAUDE.md` ("core engineering
 * and graph foundations... nothing else, no feature work"). `VPS-F001`
 * itself states Manager permission activates only once `VRS-F002` produces
 * `managed_by` edges with real Employee subjects.
 *
 * So `resolvePermission` below answers a narrower, honest question: what is
 * the CEILING this role can ever reach for this node type and partition,
 * ignoring which specific row is being asked about. Every qualifier is
 * preserved verbatim on each table cell's `scope` and `sourceText` fields
 * for fidelity testing and for the row-level narrowing a later stage adds,
 * but `resolvePermission`'s exported result carries only `outcome` and
 * `restrictedLabel` — the two fields the interceptor acts on this stage.
 * Reported as a candidate finding (F128) rather than guessed at, since
 * inventing a field-name convention to resolve "own" would be exactly the
 * kind of guess `CLAUDE.md` prohibits.
 *
 * **Three classes of matrix cell need the same honest treatment for a
 * different reason: they are not resolvable from (role, nodeType,
 * partition) at all, even in principle, without row or provenance data:**
 *
 * - `Sensitive`'s "Full (aggregate only)" for Owner/HR Admin describes
 *   access through the k-anonymity aggregate mechanism (`VPS-F005`,
 *   deliberately not built this stage), never row-level `node-get`/
 *   `node-list` access to individual PulseEntry/CoffeePulseEntry rows. The
 *   coarse outcome for THIS surface is `none`; reading "Full" literally
 *   here would let Owner/HR Admin read raw wellness-adjacent survey
 *   content, defeating the exact anonymity guarantee the aggregate
 *   mechanism exists for.
 * - `Recipient-only` (Notification) needs to know which specific user a
 *   record is addressed to. Nothing in this stage's schema knowledge
 *   supplies that, so every role resolves to `none` here — conservative,
 *   per the document's own stated asymmetry ("moving a cell from Restricted
 *   to None is always safe... conservative is the correct default for
 *   anything ambiguous").
 * - `Inherited` protection (Document, ApprovalStage, GraphReference,
 *   Insight, ReportRun, CustomFieldValue) needs the source or gated
 *   record's own class, which is instance provenance this table cannot see.
 *   Every role resolves to `none` for these node types, uniformly, rather
 *   than guessing which of the matrix's two Document rows ("Tier 0 default"
 *   vs "provenance-elevated") applies.
 *
 * Every one of these is documented as a scope decision, not silently
 * absorbed — see this stage's report for the full accounting.
 */

export const POLICY_ROLES = [
  "owner",
  "hr-admin",
  "finance-admin",
  "manager",
  "team-member",
] as const;

export type PolicyRole = (typeof POLICY_ROLES)[number];

export type PermissionOutcome = "full" | "read" | "none" | "restricted";

/** The exported resolution shape: exactly what the interceptor acts on. */
export interface PolicyResolution {
  readonly outcome: PermissionOutcome;
  readonly restrictedLabel?: string;
}

/**
 * A qualifier a matrix or default-table cell carries beyond its coarse
 * outcome. Informational only this stage — see the module doc comment.
 */
export type PolicyScope =
  | "any"
  | "own"
  | "own-plus-team"
  | "direct-reports"
  | "direct-reports-for-approval"
  | "own-band"
  | "pipeline"
  | "pipeline-plus-participant"
  | "pipeline-plus-own-entry"
  | "own-submissions"
  | "own-self-assessment"
  | "own-plan-plus-assignee"
  | "project-scoped"
  | "aggregate-only"
  | "recipient-only-unresolvable"
  | "inherited-unresolvable";

interface PolicyCell extends PolicyResolution {
  readonly scope: PolicyScope;
  /** The literal matrix or default-table cell text, for fidelity tests. */
  readonly sourceText: string;
}

function cell(
  outcome: PermissionOutcome,
  scope: PolicyScope,
  sourceText: string,
  restrictedLabel?: string,
): PolicyCell {
  return restrictedLabel === undefined
    ? { outcome, scope, sourceText }
    : { outcome, scope, sourceText, restrictedLabel };
}

const FULL_ANY = (text = "Full"): PolicyCell => cell("full", "any", text);
const READ_ANY = (text = "Read"): PolicyCell => cell("read", "any", text);
const NONE_ANY = (text = "None"): PolicyCell => cell("none", "any", text);

type RoleCells = Readonly<Record<PolicyRole, PolicyCell>>;

/**
 * The default permission mapping by Privacy Class, transcribed verbatim
 * from `VPS-A004`'s "Default permission mapping by privacy class" table.
 * Thirteen rows for the thirteen `PRIVACY_CLASSES`, minus `Inherited`,
 * which has no fixed row and is resolved separately (see the module doc
 * comment's third bullet).
 */
const DEFAULT_CLASS_MAPPING: Readonly<
  Record<Exclude<PrivacyClass, "Inherited">, RoleCells>
> = {
  Standard: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": cell("read", "own-plus-team", "Read (own + team)"),
  },
  "Finance-restricted": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "HR-restricted": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "Manager-restricted": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("read", "direct-reports", "Read (direct reports)"),
    "team-member": NONE_ANY(),
  },
  "Owner and HR Admin only": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "HR Admin only": {
    owner: READ_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "Owner only": {
    owner: FULL_ANY(),
    "hr-admin": NONE_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  Sensitive: {
    // "Full (aggregate only)" — see the module doc comment's first bullet.
    // The aggregate mechanism (VPS-F005/A004-T12-T15) is not built this
    // stage, so row-level node-get/node-list access resolves to `none`.
    owner: cell("none", "aggregate-only", "Full (aggregate only)"),
    "hr-admin": cell("none", "aggregate-only", "Full (aggregate only)"),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  "Self and Finance-restricted": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "Self only": {
    owner: NONE_ANY(),
    "hr-admin": NONE_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  "Self-only, absolute": {
    owner: NONE_ANY("None, no exceptions"),
    "hr-admin": NONE_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  "Recipient-only": {
    // See the module doc comment's second bullet: unresolvable without
    // knowing the record's addressed recipient. Conservative `none` for
    // every role, including the role that would otherwise be the
    // recipient — this stage cannot tell the difference.
    owner: cell("none", "recipient-only-unresolvable", "Own only"),
    "hr-admin": cell("none", "recipient-only-unresolvable", "Own only"),
    "finance-admin": cell("none", "recipient-only-unresolvable", "Own only"),
    manager: cell("none", "recipient-only-unresolvable", "Own only"),
    "team-member": cell("none", "recipient-only-unresolvable", "Own only"),
  },
};

/**
 * The permission matrix by node type, transcribed verbatim from
 * `VPS-A004`'s "Permission matrix by node type" table. Keyed by
 * `<NodeType>` for a fixed-protection node type, or `<NodeType>:<partitionKey>`
 * for a split-protection node type's override — partition keys taken
 * exactly from `packages/schema/src/registry/nodes.ts`'s `splitProtection`
 * calls, not reinvented here.
 *
 * A comma-joined matrix row ("HRCase, CaseEvent", "DevelopmentGoal,
 * TrainingRecord", ...) is split into one entry per node type, identical
 * grants, so lookup stays a single key per (nodeType, partitionKey).
 *
 * Document, ApprovalStage and GraphReference are deliberately absent
 * despite having their own matrix rows: all three are `inherited`
 * protection, resolved uniformly to `none` by `resolvePermission` before
 * this table is even consulted — see the module doc comment's third bullet.
 */
const MATRIX_OVERRIDES: Readonly<Record<string, Partial<RoleCells>>> = {
  "Workspace:billing": {
    owner: FULL_ANY(),
    "hr-admin": cell(
      "restricted",
      "any",
      'Restricted — "Visible to Owner"',
      "Visible to Owner",
    ),
    "finance-admin": cell(
      "restricted",
      "any",
      'Restricted — "Visible to Owner"',
      "Visible to Owner",
    ),
    manager: cell(
      "restricted",
      "any",
      'Restricted — "Visible to Owner"',
      "Visible to Owner",
    ),
    "team-member": cell(
      "restricted",
      "any",
      'Restricted — "Visible to Owner"',
      "Visible to Owner",
    ),
  },
  "Employee:operational": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": cell("read", "own-plus-team", "Read (own + team)"),
  },
  "Employee:compensation": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: cell(
      "restricted",
      "any",
      'Restricted — "Visible to Finance Admin"',
      "Visible to Finance Admin",
    ),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  WellnessTriggerEvent: {
    owner: NONE_ANY(),
    "hr-admin": NONE_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  PulseEntry: {
    owner: cell("none", "aggregate-only", "Aggregate only"),
    "hr-admin": cell("none", "aggregate-only", "Aggregate only"),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  CoffeePulseEntry: {
    owner: cell("none", "aggregate-only", "Aggregate only"),
    "hr-admin": cell("none", "aggregate-only", "Aggregate only"),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  BurnoutAlert: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": NONE_ANY(),
  },
  TimesheetAnomalyFlag: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": NONE_ANY(),
  },
  FlightRiskSignal: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  ProbationCheckIn: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": NONE_ANY(),
  },
  Assignment: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: FULL_ANY(),
    "team-member": READ_ANY(),
  },
  TimesheetEntry: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("read", "direct-reports", "Read (direct reports)"),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  LeaveRequest: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell(
      "full",
      "direct-reports-for-approval",
      "Full (direct reports, for approval)",
    ),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  Expense: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: cell("read", "direct-reports", "Read (direct reports)"),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  Invoice: {
    owner: FULL_ANY(),
    "hr-admin": READ_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  PayRun: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  PaySlip: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "Contract:identifying": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell(
      "restricted",
      "any",
      'Restricted — "Visible to HR Admin"',
      "Visible to HR Admin",
    ),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "Contract:content": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: cell(
      "restricted",
      "any",
      'Restricted — "Visible to Finance Admin"',
      "Visible to Finance Admin",
    ),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  "HRCase:identifying": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "HRCase:content": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "CaseEvent:identifying": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "CaseEvent:content": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  WorkAuthorization: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  OrgScenario: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  Candidate: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("read", "pipeline", "Read (pipeline)"),
    "team-member": NONE_ANY(),
  },
  DraftHiringRecord: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("read", "pipeline", "Read (pipeline)"),
    "team-member": NONE_ANY(),
  },
  InterviewRound: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("read", "pipeline", "Read (pipeline)"),
    "team-member": cell(
      "none",
      "pipeline-plus-participant",
      "None, plus participant grant",
    ),
  },
  FeedbackEntry: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("read", "pipeline", "Read (pipeline)"),
    "team-member": cell("none", "pipeline-plus-own-entry", "None, plus own-entry Full"),
  },
  "Offer:identifying": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "Offer:terms": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  "Requisition:identifying": {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: READ_ANY(),
    "team-member": NONE_ANY(),
  },
  "Requisition:budget": {
    owner: FULL_ANY(),
    "hr-admin": READ_ANY(),
    "finance-admin": FULL_ANY(),
    manager: cell(
      "restricted",
      "any",
      'Restricted — "Visible to Finance Admin"',
      "Visible to Finance Admin",
    ),
    "team-member": NONE_ANY(),
  },
  HeadcountPlan: {
    owner: FULL_ANY(),
    "hr-admin": READ_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  CompensationBand: {
    owner: FULL_ANY(),
    "hr-admin": READ_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own-band", "Read (own band only)"),
  },
  CompensationChange: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: NONE_ANY(),
    "team-member": cell("read", "own", "Read (own only)"),
  },
  Referral: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: READ_ANY(),
    "team-member": cell("full", "own-submissions", "Full (own submissions)"),
  },
  TalentPool: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: READ_ANY(),
    "team-member": NONE_ANY(),
  },
  ReviewEntry: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": cell("full", "own-self-assessment", "Full (own self-assessment)"),
  },
  OnboardingTask: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("read", "direct-reports", "Read (direct reports' plans)"),
    "team-member": cell(
      "read",
      "own-plan-plus-assignee",
      "Read (own plan), plus assignee Full",
    ),
  },
  DevelopmentGoal: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  TrainingRecord: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: cell("full", "direct-reports", "Full (direct reports)"),
    "team-member": cell("full", "own", "Full (own only)"),
  },
  SubVendor: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": FULL_ANY(),
    manager: READ_ANY(),
    "team-member": NONE_ANY(),
  },
  HeadcountSnapshot: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": READ_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  AuditEntry: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  ImportBatch: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  ErasureRequest: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  RetentionPolicy: {
    owner: FULL_ANY(),
    "hr-admin": FULL_ANY(),
    "finance-admin": NONE_ANY(),
    manager: NONE_ANY(),
    "team-member": NONE_ANY(),
  },
  ApplicationActivation: {
    owner: FULL_ANY(),
    "hr-admin": READ_ANY(),
    "finance-admin": READ_ANY(),
    manager: READ_ANY(),
    "team-member": READ_ANY(),
  },
};

/** Node types resolved to `none` for every role: see the doc comment's third bullet. */
const INHERITED_UNRESOLVABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "Document",
  "ApprovalStage",
  "GraphReference",
  "Insight",
  "ReportRun",
  "CustomFieldValue",
]);

function toResolution(cellValue: PolicyCell): PolicyResolution {
  return cellValue.restrictedLabel === undefined
    ? { outcome: cellValue.outcome }
    : { outcome: cellValue.outcome, restrictedLabel: cellValue.restrictedLabel };
}

const INHERITED_RESOLUTION: PolicyResolution = { outcome: "none" };

/**
 * A004-T08: given (role, nodeType, partitionKey), returns the coarse
 * permission ceiling — `outcome` and, where the matrix specifies one,
 * `restrictedLabel`. `partitionKey` is `null` only for a query the
 * interceptor cannot yet attribute to a partition (never passed by this
 * stage's interceptor, which always resolves the partition from the
 * fragment it is filtering); passing `null` for a node type that has real
 * partitions throws, since silently picking one would be exactly the
 * "renders as `Restricted` from received data" failure A004-T19 forbids.
 */
export function resolvePermission(
  role: PolicyRole,
  nodeType: NodeType,
  partitionKey: string | null,
): PolicyResolution {
  if (INHERITED_UNRESOLVABLE_NODE_TYPES.has(nodeType)) {
    return INHERITED_RESOLUTION;
  }

  const registration = getNodeRegistration(nodeType);
  const protection = registration.protection;

  if (partitionKey !== null) {
    const exact = MATRIX_OVERRIDES[`${nodeType}:${partitionKey}`]?.[role];
    if (exact) return toResolution(exact);
  }
  const bare = MATRIX_OVERRIDES[nodeType]?.[role];
  if (bare) return toResolution(bare);

  // A004-T08 fallback: no matrix entry, use the Privacy Class default.
  let privacyClass: Exclude<PrivacyClass, "Inherited">;
  if (protection.kind === "fixed") {
    privacyClass = protection.privacyClass;
  } else if (protection.kind === "split") {
    const partition = protection.partitions.find((entry) => entry.key === partitionKey);
    if (!partition) {
      throw new Error(
        `${nodeType} has no registered partition "${String(partitionKey)}"`,
      );
    }
    privacyClass = partition.privacyClass;
  } else {
    // protection.kind === "inherited" but nodeType was not in the
    // conservative set above — a new node type registered this way without
    // this table being updated. Fail loudly rather than silently granting.
    throw new Error(
      `${nodeType} has inherited protection but is not registered in ` +
        "INHERITED_UNRESOLVABLE_NODE_TYPES — this policy table is stale",
    );
  }

  return toResolution(DEFAULT_CLASS_MAPPING[privacyClass][role]);
}

/** Exposed for fidelity tests: the raw, qualifier-preserving cells. */
export const __TESTING__ = {
  DEFAULT_CLASS_MAPPING,
  MATRIX_OVERRIDES,
  INHERITED_UNRESOLVABLE_NODE_TYPES,
};
