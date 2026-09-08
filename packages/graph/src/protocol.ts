import {
  edgeRecordSchema,
  nodeRecordSchema,
  nodeTypeSchema,
  utcTimestampSchema,
  workspaceRoleSchema,
} from "@vulto/schema";
import { z } from "zod";
import { graphQuerySchema } from "./query";

/**
 * Bumped to 2 in FDN-51 Stage 4a: the `start-sync` / `stop-sync` /
 * `get-sync-status` requests, the `sync-status` result, and — the first
 * unsolicited Worker -> main message on this protocol — the
 * `sync-status-changed` event.
 */
export const GRAPH_WORKER_PROTOCOL_VERSION = 2 as const;

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
  // FDN-87. `VPS-F001` G04's erase, as a message rather than a decision:
  // this is the MECHANISM. Nothing in this package decides when it fires —
  // FDN-63 owns revocation orchestration, and the reason that boundary is
  // real rather than bureaucratic is that the role-refresh checkpoint is
  // non-enumerating, so its denial cannot distinguish revocation (wipe) from
  // an expired session (`VPS-F001`: "Nothing is wiped on expiry").
  messageBaseSchema.extend({
    type: z.literal("erase-local-store"),
    workspaceId: z.string().min(1),
  }),
  // FDN-51 Stage 4a. Start / stop the relay sync client (it runs in the
  // Worker) and read the current SyncStatus. Transitions also arrive
  // unsolicited as `sync-status-changed` events (see below).
  messageBaseSchema.extend({
    type: z.literal("start-sync"),
    relayUrl: z.string().min(1),
  }),
  messageBaseSchema.extend({ type: z.literal("stop-sync") }),
  messageBaseSchema.extend({ type: z.literal("get-sync-status") }),
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

const localStoreErasedResultSchema = z
  .object({ kind: z.literal("local-store-erased") })
  .strict();

const disposedResultSchema = z.object({ kind: z.literal("disposed") }).strict();

const roleRefreshedResultSchema = z
  .object({ kind: z.literal("role-refreshed"), roles: z.array(workspaceRoleSchema) })
  .strict();

/** FDN-51 Stage 4a — A003-T08's observable, carried both as a result and an event. */
export const syncStatusSnapshotSchema = z
  .object({
    state: z.enum(["offline", "connecting", "syncing", "synced"]),
    pendingLocalChanges: z.boolean(),
    highestKnownCursor: z.number().int().nonnegative(),
    highestAckedCursor: z.number().int().nonnegative(),
    lastError: z
      .enum([
        "unsupported_version",
        "unauthenticated",
        "malformed_frame",
        "unknown_message_type",
        "internal",
        "network",
      ])
      .nullable(),
  })
  .strict();

const syncStartedResultSchema = z.object({ kind: z.literal("sync-started") }).strict();
const syncStoppedResultSchema = z.object({ kind: z.literal("sync-stopped") }).strict();
const syncStatusResultSchema = z
  .object({ kind: z.literal("sync-status"), status: syncStatusSnapshotSchema })
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
    disposedResultSchema,
    roleRefreshedResultSchema,
    localStoreErasedResultSchema,
    syncStartedResultSchema,
    syncStoppedResultSchema,
    syncStatusResultSchema,
    ...graphQueryResultSchema.options,
  ]),
});

/**
 * The first unsolicited Worker -> main message on this protocol (FDN-51
 * Stage 4a). It is NOT a response to any request — `requestId` is null — so
 * `LocalGraphClient` routes it to `onSyncStatusChange` subscribers rather
 * than a pending promise.
 */
export const graphWorkerEventSchema = z
  .object({
    protocolVersion: z.literal(GRAPH_WORKER_PROTOCOL_VERSION),
    requestId: z.null(),
    sentAt: utcTimestampSchema,
    type: z.literal("event"),
    event: z.literal("sync-status-changed"),
    status: syncStatusSnapshotSchema,
  })
  .strict();

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
          // F148 (S4). The checkpoint could not answer — offline, a 5xx, a
          // rate limit, a malformed body. Explicitly NOT "role-refresh-denied":
          // that code means the server ruled on this device and the store is
          // now locked, and reporting a server outage with it told callers
          // that a revocation had happened when none had. This code carries
          // no lock and no ruling; the device's roles are simply stale.
          "role-refresh-unavailable",
          // F144. Writes that were acknowledged as `applied` but had not yet
          // reached disk were discarded. Its own code because a caller
          // switches on codes, not on prose: before this, losing a
          // durability window and an ordinary locked store produced the
          // byte-identical report, so no caller could tell that anything had
          // been lost. Never fatal — the data loss has already happened, and
          // killing the Worker over the report is what swallowed it.
          "local-writes-discarded",
          // F151. The local store was ERASED, not merely locked — the
          // server positively classified this session's end as one of the
          // two named revocation events. Each carries its own code rather
          // than a shared "erased" flag, so a caller (and an audit trail)
          // can tell a targeted single-device revocation from a
          // workspace-wide membership revocation without inspecting prose.
          // Never fatal, for the same reason `local-writes-discarded` is
          // not: the loss already happened, and killing the Worker over the
          // report would only hide it.
          //
          // F149. These two codes also answer a call that arrives (or was
          // already in flight) AFTER `#endLocalSession` has purged the
          // runtime back to its pre-`initialize()` state: without this, that
          // call resolved to a bare `not-initialized`, indistinguishable
          // from a Worker that was never initialized at all — so a shell
          // could render a mid-session revocation as a generic startup
          // error rather than the locked-shell transition VPS-D004 (F146)
          // defines for it.
          "device-revoked",
          "membership-revoked",
          // F149. The session ended and the runtime was purged, but the
          // server did NOT classify it as one of the two revocation events
          // above — an unclassified denial (org suspension, an unreadable
          // body). The store was locked and memory purged, not erased. Its
          // own code so a caller can tell "your access ended mid-session,
          // re-unlock to continue" from "you never initialized" (bare
          // `not-initialized`) and from an erase. Non-fatal: a re-unlock and
          // re-initialize on the same Worker is the recovery path.
          "local-session-ended",
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
  graphWorkerEventSchema,
]);

export type GraphWorkerSuccess = z.infer<typeof graphWorkerSuccessSchema>;
export type GraphWorkerError = z.infer<typeof graphWorkerErrorSchema>;
export type GraphWorkerEvent = z.infer<typeof graphWorkerEventSchema>;
export type GraphWorkerResponse = z.infer<typeof graphWorkerResponseSchema>;

export function parseGraphWorkerRequest(value: unknown): GraphWorkerRequest {
  return graphWorkerRequestSchema.parse(value);
}

export function parseGraphWorkerResponse(value: unknown): GraphWorkerResponse {
  return graphWorkerResponseSchema.parse(value);
}
