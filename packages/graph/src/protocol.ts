import {
  edgeRecordSchema,
  nodeRecordSchema,
  nodeTypeSchema,
  utcTimestampSchema,
  workspaceRoleSchema,
} from "@vulto/schema";
import { z } from "zod";
import { graphQuerySchema } from "./query";

export const GRAPH_WORKER_PROTOCOL_VERSION = 1 as const;

/**
 * FDN-53 stage 1. Mirrors `packages/graph/src/worker/storage/sqlite-graph-index.ts`'s
 * `MaterializedNode`/`MaterializedNeighbor`/`GraphQueryResult` shapes as a
 * runtime-validated schema for the Worker boundary, the same way every
 * other result on this page is. A permission-filtered result is
 * structurally a normal query result — the interceptor drops fields and
 * rows, it never adds a shape this schema would not already describe — so
 * no separate "filtered" variant is needed. A `Restricted` placeholder
 * fragment's record is a real `NodeRecord` (universal fields plus the
 * `__restricted`/`__restrictedLabel` passthrough markers), so it validates
 * against `nodeRecordSchema` exactly like any other fragment.
 */
const materializedNodeFragmentSchema = z
  .object({
    partitionKey: z.string().min(1),
    sourceDocumentId: z.string().min(1),
    record: nodeRecordSchema,
  })
  .strict();

const materializedNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    nodeType: nodeTypeSchema,
    fragments: z.array(materializedNodeFragmentSchema),
  })
  .strict();

const materializedNeighborSchema = z
  .object({ edge: edgeRecordSchema, node: materializedNodeSchema })
  .strict();

const materializedRecursiveNeighborSchema = materializedNeighborSchema.extend({
  depth: z.number().int().positive(),
});

const graphQueryResultSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("node-get"), node: materializedNodeSchema.nullable() })
    .strict(),
  z
    .object({
      kind: z.literal("node-list"),
      nodes: z.array(materializedNodeSchema),
      nextNodeId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edge-neighbors"),
      neighbors: z.array(materializedNeighborSchema),
      nextEdgeId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("recursive-neighbors"),
      neighbors: z.array(materializedRecursiveNeighborSchema),
      truncated: z.boolean(),
    })
    .strict(),
]);

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
  // FDN-53 stage 2 (F131): Worker-internal/test-only, mirroring
  // `SQLiteGraphIndex.execute()`'s treatment. No permission check of any
  // kind runs on this path. `LocalGraphClient` (the public, application-
  // facing surface) does not expose the method that sends this message;
  // only `@vulto/graph/testing/unchecked-mutation`'s widened test client
  // does, for the pre-FDN-53 browser proofs that need synthetic,
  // non-schema-conformant CRDT bytes committed unchecked. `mutate` below is
  // the gated entrypoint every application caller uses instead.
  messageBaseSchema.extend({
    type: z.literal("apply-delta-batch"),
    deltas: z.array(z.instanceof(ArrayBuffer)).min(1),
  }),
  // FDN-53 stage 2 (F131): the real, `VPS-A004` Gate-1-gated mutation
  // entrypoint. Routed through `LocalGraphWorkerRuntime#mutate`, which
  // simulates the batch against a scratch fork before ever touching the
  // canonical document — see that method's doc comment for the full gate.
  messageBaseSchema.extend({
    type: z.literal("mutate"),
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
  // FDN-53 stage 1: the first production, permission-filtered graph read
  // path (F105). Routed through `LocalGraphWorkerRuntime#executeQuery`,
  // never directly against `SQLiteGraphIndex.execute()`.
  messageBaseSchema.extend({
    type: z.literal("query"),
    query: graphQuerySchema,
  }),
  // F127: the live role-refresh receiving surface. Re-validates against the
  // server and updates the in-memory role the interceptor reads, without a
  // full re-`unlock-sealed-store`.
  messageBaseSchema.extend({ type: z.literal("refresh-role") }),
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

/** FDN-53 stage 2: `mutate`'s three outcomes, mirroring `RuntimeMutationOutcome`. */
const mutationAppliedResultSchema = z
  .object({
    kind: z.literal("mutation-applied"),
    mergedDeltaCount: z.number().int().nonnegative(),
    materializationGeneration: z.number().int().nonnegative(),
    workerDurationMs: z.number().nonnegative(),
  })
  .strict();

const mutationDeniedResultSchema = z
  .object({
    kind: z.literal("mutation-denied"),
    reason: z.string().min(1),
  })
  .strict();

const mutationUnsupportedResultSchema = z
  .object({
    kind: z.literal("mutation-unsupported"),
    reason: z.string().min(1),
  })
  .strict();

/**
 * F138. Distinct from `mutation-denied` on purpose: denied is a statement
 * about the CALLER (their roles do not permit this write), invalid is a
 * statement about the BATCH (no caller at any role could apply it, because
 * the result would not be a graph the schema permits). Collapsing them would
 * tell an Owner their own permissions were insufficient, which is both wrong
 * and unactionable.
 */
const mutationInvalidResultSchema = z
  .object({
    kind: z.literal("mutation-invalid"),
    reason: z.string().min(1),
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

const roleRefreshedResultSchema = z
  .object({ kind: z.literal("role-refreshed"), roles: z.array(workspaceRoleSchema) })
  .strict();

export const graphWorkerSuccessSchema = messageBaseSchema.extend({
  type: z.literal("success"),
  availability: graphAvailabilitySchema,
  result: z.discriminatedUnion("kind", [
    initializedResultSchema,
    deltaBatchResultSchema,
    mutationAppliedResultSchema,
    mutationDeniedResultSchema,
    mutationUnsupportedResultSchema,
    mutationInvalidResultSchema,
    availabilityResultSchema,
    sealedStoreUnlockedResultSchema,
    sealedStoreLockedResultSchema,
    sealedStoreStatusResultSchema,
    payloadSealedResultSchema,
    payloadOpenedResultSchema,
    disposedResultSchema,
    roleRefreshedResultSchema,
    ...graphQueryResultSchema.options,
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
          // FDN-53 stage 1 (F127). The server denied the role-refresh
          // checkpoint — membership revoked or session no longer current.
          // Distinct from "sealed-store-denied" (the unlock endpoint):
          // this fires on an ALREADY-unlocked Worker and, per
          // `LocalGraphWorkerRuntime#refreshRoleOnline`, also locks the
          // store as a side effect a caller should not have to infer from
          // a generic runtime-failure.
          "role-refresh-denied",
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
