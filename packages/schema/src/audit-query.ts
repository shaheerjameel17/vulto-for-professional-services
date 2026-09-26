import { z } from "zod";
import { auditEntrySchema, auditEventTypeSchema } from "./audit";
import { utcTimestampSchema, uuidV4Schema } from "./records";
import { NODE_TYPES } from "./registry/nodes";

const cursorPositionSchema = z
  .object({
    occurred_at: utcTimestampSchema,
    audit_entry_id: uuidV4Schema,
  })
  .strict();

/** Identifiers and a UTC instant only; malformed or noncanonical encodings fail closed. */
export function parseAuditLogCursor(cursor: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid audit cursor");
  const text = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  if (btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== cursor)
    throw new Error("Invalid audit cursor");
  return cursorPositionSchema.parse(JSON.parse(text));
}

export const auditLogQueryInputSchema = z
  .object({
    workspace_id: uuidV4Schema,
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    actor_user_id: uuidV4Schema.optional(),
    event_types: z.array(auditEventTypeSchema).optional(),
    target_node_type: z.enum(NODE_TYPES).optional(),
    target_tier: z.int().min(0).max(3).optional(),
    cursor: z
      .string()
      .refine((value) => {
        try {
          parseAuditLogCursor(value);
          return true;
        } catch {
          return false;
        }
      }, "Invalid audit cursor")
      .optional(),
    limit: z.int().min(1).max(200).default(50),
  })
  .strict();

export const auditLogQueryOutputSchema = z
  .object({
    entries: z.array(auditEntrySchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export type AuditLogQueryInput = z.infer<typeof auditLogQueryInputSchema>;
