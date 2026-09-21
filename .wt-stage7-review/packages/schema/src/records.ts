import { z } from "zod";

import { EDGE_TYPES, type EdgeType } from "./registry/edges";
import {
  getNodeRegistration,
  isNodeType,
  NODE_TYPES,
  type NodeType,
} from "./registry/nodes";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const isJsonNative = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonNative);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonNative);
};

const addJsonNativeIssue = (value: unknown, context: z.RefinementCtx): void => {
  if (!isJsonNative(value)) {
    context.addIssue({
      code: "custom",
      message:
        "Graph records must contain JSON-native values only; class instances, undefined, non-finite numbers and other runtime-specific values are prohibited",
    });
  }
};

export const uuidV4Schema = z.uuidv4();

export const utcTimestampSchema = z.iso
  .datetime({ offset: false, local: false })
  .refine((value) => value.endsWith("Z"), {
    message: "Timestamp must be UTC and end in Z",
  });

export const nodeTypeSchema = z.enum(NODE_TYPES);
export const edgeTypeSchema = z.enum(EDGE_TYPES);

const baseNodeFields = {
  node_id: uuidV4Schema,
  schema_version: z.int().positive(),
  lifecycle_status: z.string().min(1),
  created_at: utcTimestampSchema,
} as const;

const anonymousBaseNodeFields = {
  node_id: uuidV4Schema,
  schema_version: z.int().positive(),
  lifecycle_status: z.string().min(1),
} as const;

const mutableNodeFields = {
  updated_at: utcTimestampSchema,
  updated_by: uuidV4Schema,
  is_soft_deleted: z.boolean(),
  soft_deleted_at: utcTimestampSchema.nullable(),
  soft_deleted_by: uuidV4Schema.nullable(),
} as const;

interface SoftDeleteRecord {
  is_soft_deleted: boolean;
  soft_deleted_at: string | null;
  soft_deleted_by: string | null;
}

const addSoftDeleteIssues = (
  record: SoftDeleteRecord,
  context: z.RefinementCtx,
): void => {
  const hasDeletionProvenance =
    record.soft_deleted_at !== null && record.soft_deleted_by !== null;

  if (record.is_soft_deleted !== hasDeletionProvenance) {
    context.addIssue({
      code: "custom",
      path: ["is_soft_deleted"],
      message:
        "Soft deletion requires both soft_deleted_at and soft_deleted_by; an active node requires both to be null",
    });
  }
};

const standardScopedNodeSchema = z
  .object({
    ...baseNodeFields,
    node_type: nodeTypeSchema.refine(
      (nodeType) =>
        nodeType !== "User" &&
        nodeType !== "Workspace" &&
        getNodeRegistration(nodeType).universalFields === "standard",
      { message: "Node type does not use the workspace-scoped standard shape" },
    ),
    workspace_id: uuidV4Schema,
    created_by: uuidV4Schema,
    ...mutableNodeFields,
  })
  .passthrough()
  .superRefine(addSoftDeleteIssues);

const standardUnscopedNodeSchema = z
  .object({
    ...baseNodeFields,
    node_type: z.enum(["User", "Workspace"]),
    workspace_id: z.never().optional(),
    created_by: uuidV4Schema,
    ...mutableNodeFields,
  })
  .passthrough()
  .superRefine(addSoftDeleteIssues);

const anonymousContributionNodeSchema = z
  .object({
    ...anonymousBaseNodeFields,
    node_type: z.enum(["PulseAggregateContribution", "WellnessAggregateContribution"]),
    workspace_id: uuidV4Schema,
    created_at: z.never().optional(),
    created_by: z.never().optional(),
    updated_at: z.never().optional(),
    updated_by: z.never().optional(),
    is_soft_deleted: z.boolean(),
    soft_deleted_at: z.never().optional(),
    soft_deleted_by: z.never().optional(),
  })
  .passthrough();

const auditEntryNodeSchema = z
  .object({
    ...baseNodeFields,
    node_type: z.literal("AuditEntry"),
    workspace_id: uuidV4Schema,
    created_by: uuidV4Schema,
    updated_at: z.never().optional(),
    updated_by: z.never().optional(),
    is_soft_deleted: z.never().optional(),
    soft_deleted_at: z.never().optional(),
    soft_deleted_by: z.never().optional(),
  })
  .passthrough();

export const nodeRecordSchema = z
  .union([
    standardScopedNodeSchema,
    standardUnscopedNodeSchema,
    anonymousContributionNodeSchema,
    auditEntryNodeSchema,
  ])
  .superRefine((record, context) => {
    addJsonNativeIssue(record, context);

    if (!isNodeType(record.node_type)) {
      context.addIssue({
        code: "custom",
        path: ["node_type"],
        message: `Unregistered node type: ${record.node_type}`,
      });
      return;
    }

    const registration = getNodeRegistration(record.node_type);

    if (
      registration.lifecycle.kind === "fixed" &&
      !registration.lifecycle.statuses.includes(record.lifecycle_status)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lifecycle_status"],
        message: `${record.lifecycle_status} is not a registered lifecycle status for ${record.node_type}`,
      });
    }
  });

export type NodeRecord = z.infer<typeof nodeRecordSchema>;

export const edgeRecordSchema = z
  .object({
    edge_id: uuidV4Schema,
    edge_type: edgeTypeSchema,
    from_node_id: uuidV4Schema,
    to_node_id: uuidV4Schema,
    effective_from: utcTimestampSchema.nullable(),
    effective_to: utcTimestampSchema.nullable(),
    created_at: utcTimestampSchema,
    created_by: uuidV4Schema,
    metadata: jsonValueSchema,
    is_soft_deleted: z.boolean(),
    soft_deleted_at: utcTimestampSchema.nullable(),
    soft_deleted_by: uuidV4Schema.nullable(),
  })
  .passthrough()
  .superRefine((record, context) => {
    addJsonNativeIssue(record, context);
    addSoftDeleteIssues(record, context);

    if (
      record.effective_from !== null &&
      record.effective_to !== null &&
      Date.parse(record.effective_from) >= Date.parse(record.effective_to)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effective_to"],
        message:
          "effective_to must be later than effective_from for a half-open interval",
      });
    }
  });

export type EdgeRecord = z.infer<typeof edgeRecordSchema>;

export const parseNodeRecord = (value: unknown): NodeRecord =>
  nodeRecordSchema.parse(value);

export const parseEdgeRecord = (value: unknown): EdgeRecord =>
  edgeRecordSchema.parse(value);

// These aliases make the cross-language representation explicit at imports.
export type WireNodeType = NodeType;
export type WireEdgeType = EdgeType;
