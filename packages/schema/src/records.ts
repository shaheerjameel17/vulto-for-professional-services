import { z } from "zod";

import { EDGE_TYPES, type EdgeType } from "./registry/edges.js";
import {
  getNodeRegistration,
  isNodeType,
  NODE_TYPES,
  type NodeType,
} from "./registry/nodes.js";

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
    ...baseNodeFields,
    node_type: z.enum(["PulseAggregateContribution", "WellnessAggregateContribution"]),
    workspace_id: uuidV4Schema,
    created_by: z.never().optional(),
    ...mutableNodeFields,
  })
  .passthrough()
  .superRefine(addSoftDeleteIssues);

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
  .superRefine(addSoftDeleteIssues);

export type EdgeRecord = z.infer<typeof edgeRecordSchema>;

export const parseNodeRecord = (value: unknown): NodeRecord =>
  nodeRecordSchema.parse(value);

export const parseEdgeRecord = (value: unknown): EdgeRecord =>
  edgeRecordSchema.parse(value);

// These aliases make the cross-language representation explicit at imports.
export type WireNodeType = NodeType;
export type WireEdgeType = EdgeType;
