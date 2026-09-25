import type { NodeType } from "../registry/nodes";
import type { EdgeType } from "../registry/edges";

/**
 * VPS-A004 "Principals that are not members" — the policy rows for system
 * principals (A004-T22).
 *
 * A system principal is a named identity for a system job. Its permitted
 * operations are listed here and nowhere else; an operation not listed for the
 * name is refused. Operations are added, with the stage that builds the job,
 * only when the code that performs them exists, so this table never promises
 * an operation nothing implements.
 */
export const SYSTEM_PRINCIPAL_NAMES = [
  "audience-recompute",
  "retention-sweep",
  "erasure",
  "key-rotation",
  "timesheet-anomaly-evaluate",
  "utilization-snapshot-compute",
  "revenue-gap-alert-evaluate",
  "skill-gap-evaluate",
] as const;

export type SystemPrincipalName = (typeof SYSTEM_PRINCIPAL_NAMES)[number];

/** Human-readable labels for system-authored graph provenance (F272). */
export const SYSTEM_PRINCIPAL_DISPLAY_NAMES: Readonly<
  Record<SystemPrincipalName, string>
> = {
  "audience-recompute": "Audience Recompute",
  "retention-sweep": "Retention Sweep",
  erasure: "Data Erasure",
  "key-rotation": "Key Rotation",
  "timesheet-anomaly-evaluate": "Automatic Review",
  "utilization-snapshot-compute": "Utilization Snapshot",
  "revenue-gap-alert-evaluate": "Revenue Gap Alert",
  "skill-gap-evaluate": "Skill Gap Evaluation",
};

export const SYSTEM_OPERATIONS = [
  "audit.pseudonymize-actor",
  "protected.destroy-key",
  "audience.recompute",
  "timesheet-anomaly.create-flag",
  "timesheet-anomaly.read-flags",
  "utilization-snapshot.compute",
  "utilization-snapshot.read-cohort",
  "revenue-gap-alert.write",
  "skill-gap.write",
  "skill-gap.read-cohort",
] as const;

export type SystemOperation = (typeof SYSTEM_OPERATIONS)[number];

export const SYSTEM_PRINCIPAL_OPERATIONS: Readonly<
  Record<SystemPrincipalName, readonly SystemOperation[]>
> = {
  // Keeping each person's sync audience equal to what the interceptor permits
  // (A003-T57). It decides with the side-effect-free `decide*` functions and
  // writes only the two audience tables.
  "audience-recompute": ["audience.recompute"],
  "retention-sweep": [],
  // VPS-F004 G06: actor pseudonymization on erasure is the one narrow
  // in-place change the audit journal permits.
  // Destroying a Tier 1 erasure domain's data key is cryptographic erasure
  // (A003-T62). Key rotation has no operation yet: its job is not built.
  erasure: ["audit.pseudonymize-actor", "protected.destroy-key"],
  "key-rotation": [],
  "timesheet-anomaly-evaluate": [
    "timesheet-anomaly.create-flag",
    "timesheet-anomaly.read-flags",
  ],
  "utilization-snapshot-compute": [
    "utilization-snapshot.compute",
    "utilization-snapshot.read-cohort",
  ],
  "revenue-gap-alert-evaluate": ["revenue-gap-alert.write"],
  "skill-gap-evaluate": ["skill-gap.write", "skill-gap.read-cohort"],
};

export interface SystemOperationTarget {
  readonly nodeType: NodeType;
  readonly partitionKey: string;
}

/** A004-T25: the closed node targets for each system operation. */
export const SYSTEM_OPERATION_TARGETS: Readonly<
  Partial<Record<SystemOperation, readonly SystemOperationTarget[]>>
> = {
  "timesheet-anomaly.create-flag": [
    { nodeType: "TimesheetAnomalyFlag", partitionKey: "record" },
  ],
  "timesheet-anomaly.read-flags": [
    { nodeType: "TimesheetAnomalyFlag", partitionKey: "record" },
  ],
  "utilization-snapshot.compute": [
    { nodeType: "UtilizationSnapshot", partitionKey: "record" },
  ],
  "utilization-snapshot.read-cohort": [
    { nodeType: "Employee", partitionKey: "operational" },
    { nodeType: "UtilizationSnapshot", partitionKey: "record" },
  ],
  "revenue-gap-alert.write": [{ nodeType: "RevenueGapAlert", partitionKey: "record" }],
  "skill-gap.write": [{ nodeType: "SkillGap", partitionKey: "record" }],
  "skill-gap.read-cohort": [{ nodeType: "Employee", partitionKey: "operational" }],
};

export function isSystemOperationPermitted(
  name: SystemPrincipalName,
  operation: SystemOperation,
): boolean {
  return SYSTEM_PRINCIPAL_OPERATIONS[name].includes(operation);
}

/** Closed structural edge grants; never a PolicyRole grant. */
export const SYSTEM_EDGE_OPERATION_TARGETS: Readonly<
  Partial<
    Record<
      SystemOperation,
      readonly {
        edgeType: EdgeType;
        fromNodeType: NodeType;
        toNodeType: NodeType;
      }[]
    >
  >
> = {
  "timesheet-anomaly.create-flag": [
    {
      edgeType: "triggered_by",
      fromNodeType: "TimesheetAnomalyFlag",
      toNodeType: "Employee",
    },
  ],
  "revenue-gap-alert.write": [
    {
      edgeType: "triggered_by",
      fromNodeType: "RevenueGapAlert",
      toNodeType: "Employee",
    },
  ],
  "skill-gap.write": [
    { edgeType: "gap_for", fromNodeType: "SkillGap", toNodeType: "Skill" },
  ],
};
