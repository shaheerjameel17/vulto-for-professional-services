import { z } from "zod";

import { deviceApplicationSchema } from "./auth";
import { POLICY_ROLES } from "./policy/policy-table";
import { EDGE_TYPES } from "./registry/edges";
import { NODE_TYPES } from "./registry/nodes";
import { type DataTier } from "./registry/types";

const policyRoleSchema = z.enum(POLICY_ROLES);
const uuidV4Schema = z.uuidv4();
const utcTimestampSchema = z.iso
  .datetime({ offset: false, local: false })
  .refine((value) => value.endsWith("Z"), {
    message: "Timestamp must be UTC and end in Z",
  });
const nodeTypeSchema = z.enum(NODE_TYPES);
const edgeTypeSchema = z.enum(EDGE_TYPES);

export const AUDIT_EVENT_TYPES = [
  "PermissionDenied",
  "SensitiveAccessGranted",
  "AuthorizedOperationFailed",
  "PrivilegedProjectionAuthorized",
] as const;
export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const AUDIT_OPERATIONS = [
  "NodeRead",
  "NodeList",
  "EdgeTraversal",
  "RecursiveTraversal",
  "NodeCreate",
  "NodeUpdate",
  "NodeRemoveAttempt",
  "EdgeCreate",
  "EdgeUpdate",
  "EdgeRemoveAttempt",
] as const;
export const auditOperationSchema = z.enum(AUDIT_OPERATIONS);
export type AuditOperation = z.infer<typeof auditOperationSchema>;

export const AUDIT_OUTCOMES = ["Granted", "Denied", "Failed"] as const;
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

const dataTierSchema: z.ZodType<DataTier> = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const auditNodeTargetSchema = z
  .object({
    kind: z.literal("NodeTarget"),
    node_type: nodeTypeSchema,
    node_id: uuidV4Schema.nullable(),
    partition_key: z.string().min(1).nullable(),
    target_tier: dataTierSchema,
  })
  .strict();

export const auditEdgeTargetSchema = z
  .object({
    kind: z.literal("EdgeTarget"),
    edge_type: edgeTypeSchema,
    edge_id: uuidV4Schema.nullable(),
    from_node_type: nodeTypeSchema.nullable(),
    to_node_type: nodeTypeSchema.nullable(),
    target_tier: dataTierSchema,
  })
  .strict();

export const AUDIT_QUERY_KINDS = [
  "node-get",
  "node-list",
  "edge-neighbors",
  "recursive-neighbors",
] as const;

export const auditQueryTargetSchema = z
  .object({
    kind: z.literal("QueryTarget"),
    query_kind: z.enum(AUDIT_QUERY_KINDS),
    requested_node_type: nodeTypeSchema.nullable(),
    target_tier: dataTierSchema.nullable(),
  })
  .strict();

export const auditTargetReferenceSchema = z.discriminatedUnion("kind", [
  auditNodeTargetSchema,
  auditEdgeTargetSchema,
  auditQueryTargetSchema,
]);
export type AuditTargetReference = z.infer<typeof auditTargetReferenceSchema>;

export const AUDIT_DENIAL_CLASSES = [
  "InsufficientPermission",
  "UnregisteredRelationship",
  "UnresolvedProtection",
] as const;
export const auditDenialClassSchema = z.enum(AUDIT_DENIAL_CLASSES);

export const AUDIT_FAILURE_CLASSES = [
  "InvalidInput",
  "UnsupportedOperation",
  "CommitFailed",
  "AuditPersistenceFailed",
] as const;
export const auditFailureClassSchema = z.enum(AUDIT_FAILURE_CLASSES);

export const AUDIT_RESULT_CARDINALITIES = ["Single", "Collection"] as const;
export const auditResultCardinalitySchema = z.enum(AUDIT_RESULT_CARDINALITIES);

export const AUDIT_AUTHORIZATION_PATHS = ["PrivilegedProjectionException"] as const;
export const auditAuthorizationPathSchema = z.enum(AUDIT_AUTHORIZATION_PATHS);

export const AUDIT_PROJECTION_KINDS = [
  "Admission",
  "RoleChange",
  "Revocation",
] as const;
export const auditProjectionKindSchema = z.enum(AUDIT_PROJECTION_KINDS);

export const auditMetadataSchema = z
  .object({
    denial_class: auditDenialClassSchema.optional(),
    failure_class: auditFailureClassSchema.optional(),
    result_cardinality: auditResultCardinalitySchema.optional(),
    authorization_path: auditAuthorizationPathSchema.optional(),
    projection_kind: auditProjectionKindSchema.optional(),
  })
  .strict();
export type AuditMetadata = z.infer<typeof auditMetadataSchema>;

export const auditEntryEventFields = {
  event_type: auditEventTypeSchema,
  operation: auditOperationSchema,
  outcome: auditOutcomeSchema,
  actor_user_id: uuidV4Schema,
  actor_membership_id: uuidV4Schema,
  actor_role: policyRoleSchema.nullable(),
  actor_roles: z.array(policyRoleSchema).min(1),
  actor_application: deviceApplicationSchema.default("VultoRoster"),
  target: auditTargetReferenceSchema,
  metadata: auditMetadataSchema,
  occurred_at: utcTimestampSchema,
} as const;

function addAuditCoherenceIssues(
  entry: {
    event_type: AuditEventType;
    outcome: AuditOutcome;
    actor_role: string | null;
    actor_roles: readonly z.infer<typeof policyRoleSchema>[];
    metadata: AuditMetadata;
  },
  context: z.RefinementCtx,
): void {
  const expectedOutcome: Record<AuditEventType, AuditOutcome> = {
    PermissionDenied: "Denied",
    SensitiveAccessGranted: "Granted",
    AuthorizedOperationFailed: "Failed",
    PrivilegedProjectionAuthorized: "Granted",
  };
  if (entry.outcome !== expectedOutcome[entry.event_type]) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: `${entry.event_type} requires outcome ${expectedOutcome[entry.event_type]}`,
    });
  }
  if (entry.outcome === "Denied" && entry.actor_role !== null) {
    context.addIssue({
      code: "custom",
      path: ["actor_role"],
      message: "A denied audit event cannot name a deciding role",
    });
  }
  if (
    entry.event_type === "PrivilegedProjectionAuthorized" &&
    entry.actor_role !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor_role"],
      message: "A privileged projection audit event cannot name a deciding role",
    });
  }
  const suppliedRoles = new Set(entry.actor_roles);
  const canonicalRoles = POLICY_ROLES.filter((role) => suppliedRoles.has(role));
  if (
    canonicalRoles.length !== entry.actor_roles.length ||
    canonicalRoles.some((role, index) => role !== entry.actor_roles[index])
  ) {
    context.addIssue({
      code: "custom",
      path: ["actor_roles"],
      message: "actor_roles must be unique and canonically sorted",
    });
  }
  if (
    entry.event_type === "AuthorizedOperationFailed" &&
    entry.metadata.failure_class === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["metadata", "failure_class"],
      message: "AuthorizedOperationFailed requires a closed failure_class",
    });
  }
  if (entry.event_type === "PrivilegedProjectionAuthorized") {
    if (entry.metadata.authorization_path === undefined) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "authorization_path"],
        message:
          "PrivilegedProjectionAuthorized requires its closed authorization_path",
      });
    }
    if (entry.metadata.projection_kind === undefined) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "projection_kind"],
        message: "PrivilegedProjectionAuthorized requires its closed projection_kind",
      });
    }
  } else if (
    entry.metadata.authorization_path !== undefined ||
    entry.metadata.projection_kind !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["metadata"],
      message:
        "Projection authorization metadata belongs only to privileged projections",
    });
  }
}

/** VPS-F004's canonical, append-journal AuditEntry contract. */
export const auditEntrySchema = z
  .object({
    audit_entry_id: uuidV4Schema,
    schema_version: z.literal(1),
    workspace_id: uuidV4Schema,
    ...auditEntryEventFields,
  })
  .strict()
  .superRefine(addAuditCoherenceIssues);
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const refineAuditEntryCoherence = addAuditCoherenceIssues;
