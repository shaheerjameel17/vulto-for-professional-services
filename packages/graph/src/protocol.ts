import { utcTimestampSchema } from "@vulto/schema";
import { z } from "zod";

export const GRAPH_WORKER_PROTOCOL_VERSION = 1 as const;

const messageBaseSchema = z
  .object({
    protocolVersion: z.literal(GRAPH_WORKER_PROTOCOL_VERSION),
    requestId: z.string().min(1),
    sentAt: utcTimestampSchema,
  })
  .strict();

export const graphAvailabilitySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("mid-sync") }).strict(),
  z.object({ state: z.literal("retention-window-absence") }).strict(),
  z.object({ state: z.literal("permission-absence") }).strict(),
  z.object({ state: z.literal("ready") }).strict(),
]);

export type GraphAvailability = z.infer<typeof graphAvailabilitySchema>;

export const graphWorkerRequestSchema = z.discriminatedUnion("type", [
  messageBaseSchema.extend({
    type: z.literal("initialize"),
    workspaceId: z.string().min(1),
  }),
  messageBaseSchema.extend({
    type: z.literal("apply-delta-batch"),
    deltas: z.array(z.instanceof(ArrayBuffer)).min(1),
  }),
  messageBaseSchema.extend({ type: z.literal("get-availability") }),
  messageBaseSchema.extend({ type: z.literal("dispose") }),
]);

export type GraphWorkerRequest = z.infer<typeof graphWorkerRequestSchema>;

const initializedResultSchema = z
  .object({
    kind: z.literal("initialized"),
    workspaceId: z.string().min(1),
  })
  .strict();

const deltaBatchResultSchema = z
  .object({
    kind: z.literal("delta-batch-applied"),
    mergedDeltaCount: z.number().int().nonnegative(),
    materializationGeneration: z.number().int().nonnegative(),
    workerDurationMs: z.number().nonnegative(),
  })
  .strict();

const availabilityResultSchema = z.object({ kind: z.literal("availability") }).strict();

const disposedResultSchema = z.object({ kind: z.literal("disposed") }).strict();

export const graphWorkerSuccessSchema = messageBaseSchema.extend({
  type: z.literal("success"),
  availability: graphAvailabilitySchema,
  result: z.discriminatedUnion("kind", [
    initializedResultSchema,
    deltaBatchResultSchema,
    availabilityResultSchema,
    disposedResultSchema,
  ]),
});

export const graphWorkerErrorSchema = z
  .object({
    protocolVersion: z.literal(GRAPH_WORKER_PROTOCOL_VERSION),
    requestId: z.string().min(1).nullable(),
    sentAt: utcTimestampSchema,
    type: z.literal("error"),
    error: z
      .object({
        code: z.enum([
          "invalid-message",
          "protocol-mismatch",
          "not-initialized",
          "already-initialized",
          "runtime-failure",
        ]),
        message: z.string().min(1),
        fatal: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const graphWorkerResponseSchema = z.discriminatedUnion("type", [
  graphWorkerSuccessSchema,
  graphWorkerErrorSchema,
]);

export type GraphWorkerSuccess = z.infer<typeof graphWorkerSuccessSchema>;
export type GraphWorkerError = z.infer<typeof graphWorkerErrorSchema>;
export type GraphWorkerResponse = z.infer<typeof graphWorkerResponseSchema>;

export function parseGraphWorkerRequest(value: unknown): GraphWorkerRequest {
  return graphWorkerRequestSchema.parse(value);
}

export function parseGraphWorkerResponse(value: unknown): GraphWorkerResponse {
  return graphWorkerResponseSchema.parse(value);
}
