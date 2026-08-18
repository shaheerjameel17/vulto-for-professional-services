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
  messageBaseSchema.extend({
    type: z.literal("unlock-sealed-store"),
    workspaceId: z.string().min(1),
    apiOrigin: z.string().min(1),
  }),
  messageBaseSchema.extend({ type: z.literal("lock-sealed-store") }),
  messageBaseSchema.extend({ type: z.literal("get-sealed-store-status") }),
  messageBaseSchema.extend({
    type: z.literal("seal-payload"),
    storeKey: z.string().min(1),
    plaintext: z.instanceof(ArrayBuffer),
  }),
  messageBaseSchema.extend({
    type: z.literal("open-payload"),
    storeKey: z.string().min(1),
  }),
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

const sealedStoreUnlockedResultSchema = z
  .object({ kind: z.literal("sealed-store-unlocked") })
  .strict();

const sealedStoreLockedResultSchema = z
  .object({ kind: z.literal("sealed-store-locked") })
  .strict();

const sealedStoreStatusResultSchema = z
  .object({ kind: z.literal("sealed-store-status"), locked: z.boolean() })
  .strict();

const payloadSealedResultSchema = z
  .object({ kind: z.literal("payload-sealed") })
  .strict();

const payloadOpenedResultSchema = z
  .object({
    kind: z.literal("payload-opened"),
    plaintext: z.instanceof(ArrayBuffer).nullable(),
  })
  .strict();

const disposedResultSchema = z.object({ kind: z.literal("disposed") }).strict();

export const graphWorkerSuccessSchema = messageBaseSchema.extend({
  type: z.literal("success"),
  availability: graphAvailabilitySchema,
  result: z.discriminatedUnion("kind", [
    initializedResultSchema,
    deltaBatchResultSchema,
    availabilityResultSchema,
    sealedStoreUnlockedResultSchema,
    sealedStoreLockedResultSchema,
    sealedStoreStatusResultSchema,
    payloadSealedResultSchema,
    payloadOpenedResultSchema,
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
          "sealed-store-denied",
          "sealed-store-locked",
          "sealed-store-cannot-open",
          // FDN-50 stage 3. Its own code, never folded into any of the three
          // sealed-store codes above or into "runtime-failure": the store
          // unlocked, the bytes authenticated, the document imported, and
          // the refusal is about the schema generation it was written under.
          // A caller that cannot tell those apart cannot react correctly to
          // any of them.
          "document-schema-generation-unsupported",
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
