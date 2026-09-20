import {
  auditEntrySchema,
  auditEventTypeSchema,
  auditOperationSchema,
  auditOutcomeSchema,
  nodeTypeSchema,
  utcTimestampSchema,
} from "@vulto/schema";
import { z } from "zod";

const auditTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const auditLogQueryFiltersSchema = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    startDate: utcTimestampSchema.optional(),
    endDate: utcTimestampSchema.optional(),
    actorUserId: z.uuidv4().optional(),
    eventType: auditEventTypeSchema.optional(),
    operation: auditOperationSchema.optional(),
    outcome: auditOutcomeSchema.optional(),
    targetNodeType: nodeTypeSchema.optional(),
    targetTier: auditTierSchema.optional(),
  })
  .strict()
  .superRefine((filters, context) => {
    if (
      filters.startDate !== undefined &&
      filters.endDate !== undefined &&
      Date.parse(filters.startDate) > Date.parse(filters.endDate)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate must not be earlier than startDate",
      });
    }
  });

export const auditLogQueryRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    filters: auditLogQueryFiltersSchema.default({ limit: 50 }),
  })
  .strict();

export const AUDIT_LOG_QUERY_DENIED_REASON =
  "Audit log access is not available" as const;

export const auditLogPageSchema = z
  .object({
    kind: z.literal("audit-log-page"),
    entries: z.array(auditEntrySchema),
    nextCursor: z.string().min(1).optional(),
    source: z.enum(["Local", "Historical"]),
  })
  .strict();

export const auditLogDeniedSchema = z
  .object({
    kind: z.literal("audit-log-denied"),
    reason: z.literal(AUDIT_LOG_QUERY_DENIED_REASON),
  })
  .strict();

export const auditLogRetentionWindowUnavailableSchema = z
  .object({
    kind: z.literal("audit-log-retention-window-unavailable"),
    availableFrom: utcTimestampSchema,
  })
  .strict();

export const auditLogQueryResultSchema = z.discriminatedUnion("kind", [
  auditLogPageSchema,
  auditLogDeniedSchema,
  auditLogRetentionWindowUnavailableSchema,
]);

/** Worker/API transport shape; the public client wraps this as a Historical page. */
export const auditHistoricalTransportPageSchema = z
  .object({
    entries: z.array(auditEntrySchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type AuditLogQueryFilters = z.input<typeof auditLogQueryFiltersSchema>;
export type AuditLogQueryRequest = z.input<typeof auditLogQueryRequestSchema>;
export type AuditLogQueryResult = z.infer<typeof auditLogQueryResultSchema>;
export type AuditHistoricalTransportPage = z.infer<
  typeof auditHistoricalTransportPageSchema
>;

export interface AuditLogClient {
  query(
    workspaceId: string,
    filters?: AuditLogQueryFilters,
  ): Promise<AuditLogQueryResult>;
}
