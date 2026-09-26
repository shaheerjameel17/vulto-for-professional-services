import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "./records";
import { isNodeType } from "./registry/nodes";

/** VPS-F003's recipient-only Tier 0 record and universal node envelope. */
export const notificationFieldsSchema = z
  .object({
    node_id: uuidV4Schema,
    workspace_id: uuidV4Schema,
    node_type: z.literal("Notification"),
    schema_version: z.int().positive(),
    lifecycle_status: z.string().min(1),
    created_at: utcTimestampSchema,
    created_by: uuidV4Schema,
    updated_at: utcTimestampSchema,
    updated_by: uuidV4Schema,
    is_soft_deleted: z.boolean(),
    soft_deleted_at: utcTimestampSchema.nullable(),
    soft_deleted_by: uuidV4Schema.nullable(),
    recipient_user_id: uuidV4Schema,
    source_node_type: z.string().refine(isNodeType, "Unregistered source node type"),
    source_node_id: uuidV4Schema,
    category: z.enum(["ActionNeeded", "Informational"]),
    message: z.string().min(1).max(300),
    read_at: utcTimestampSchema.nullable(),
    dismissed_at: utcTimestampSchema.nullable(),
    rule_id: z.string().min(1),
    dedupe_key: z.string().min(1),
  })
  .strict();
