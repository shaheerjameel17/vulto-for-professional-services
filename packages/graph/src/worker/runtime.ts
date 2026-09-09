import type { WorkspaceRole } from "@vulto/schema";
import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import type { GraphAvailability } from "../protocol";
import type { GraphQuery } from "../query";
import {
  assertDocumentSchemaGenerationReadable,
  stampDocumentSchemaGeneration,
} from "./document-schema-gate";
import { readEdgeFragments } from "./document-edge-fragments";
import { readNodeFragments } from "./document-node-fragments";
import { materializeManagedByEdges } from "./managed-by-materialization";
import { deriveEffectiveRoles } from "./permission/effective-roles";
import { executeWithPermissions } from "./permission/interceptor";
import { authorizeMutationBatch } from "./permission/mutation-interceptor";
import {
  fetchCurrentRoles,
  RoleRefreshDeniedError,
  type RoleRefreshDenialReason,
} from "./permission/role-refresh";
import {
  SealedStore,
  SealedStoreConflictError,
  SealedStoreEnvelopeMismatchError,
  SealedStoreLockedError,
  type SealedStoreCommit,
  type SealedStoreVersionedValue,
} from "./storage/sealed-store";
import { SQLiteGraphIndex, type GraphQueryResult } from "./storage/sqlite-graph-index";
import {
  graphSnapshotStoreKey,
  protectedPartitionManifestStoreKey,
  syncMarkerStoreKey,
  tier1IdentityStoreKey,
  tier3PartitionManifestStoreKey,
} from "./storage/storage-keys";
import {
  WORKSPACE_GRAPH_DOCUMENT_ID,
  WorkspaceSyncClient,
  type SyncStatusSnapshot,
} from "../sync/client";
import { SyncLeadership } from "../sync/single-active";
import {
  ProtectedPartitionRegistry,
  type ProtectedReaderCredential,
  type Tier1RetentionState,
} from "./protected-partitions";
import type { ProtectedDocumentAddress } from "./protected-document";
import type { Tier1Recipient } from "./tier1-envelope";
import {
  assertP256KeyPair,
  createTier1IdentityTransfer,
  exportP256PublicKey,
  generateTier1TransferKeyPair,
  importP256PublicKey,
  openTier1IdentityTransfer,
  tier1IdentityTransferPayloadSchema,
  type Tier1IdentityTransferPayload,
} from "./tier1-identity-transfer";
import { Tier3PartitionRegistry } from "./tier3-partitions";
import type { Tier3RootAddress } from "./tier3-root";

/**
 * F127's explicitly-labeled PLACEHOLDER delivery mechanism for the live
 * role-refresh channel. FDN-53 must prove the whole refresh path end to
 * end now, real signal to real effect, rather than assert it against a
 * mock (per F127's closing paragraph) — so this stage builds a working
 * minimal transport rather than only the receiving surface. `FDN-63` is
 * named as the natural place to replace this poll with a real push
 * mechanism once device-level revocation transport exists anyway, behind
 * the `refreshRoleOnline()` method below, which does not change shape when
 * that happens.
 *
 * `VPS-F001`'s Security Considerations (F127) bound a role narrowing to
 * reach an online session "within the same window already specified for
 * device wipe: within 60 seconds while online." An interval must land
 * comfortably inside that bound, not graze it — request latency, a slow
 * tick, or a device briefly busy with a flush (FDN-50 stage 2) all eat into
 * it. 15 seconds gives four polls per 60-second window: the worst case is a
 * narrowing that lands the instant after one poll fires, caught by the
 * next at most ~15s later, leaving roughly 45s of margin against the 60s
 * bound. That is also far from hammering `/device-store/roles` — one
 * request per unlocked Worker per 15s, not per second. Not read from any
 * specification; none names a poll interval, only the 60-second bound this
 * value must land inside, the same way stage 2's `FLUSH_DEBOUNCE_MS` was
 * reasoned about rather than looked up.
 */
const ROLE_REFRESH_POLL_INTERVAL_MS = 15_000;

export interface RuntimeDeltaBatchResult {
  mergedDeltaCount: number;
  materializationGeneration: number;
  workerDurationMs: number;
}

/**
 * FDN-53 stage 2, extended by FDN-92. `mutate`'s outcomes: authorized and
 * committed (`applied`), refused by Gate 1 (`denied`), refused as incoherent
 * (`invalid`, F138), or refused because the batch touches state with no
 * committable convention (`unsupported` — the Movable Tree, the reserved
 * document-meta container, or anything other than the node-fragment and
 * edge-fragment containers; see F132/F134). Node fragments (FDN-53 stage 2)
 * and generic edge fragments (FDN-92) are both committable; `managed_by`
 * moves are still `unsupported` here — they go through the Tree, not `mutate`
 * (F104) — and so are Workspace / WorkspaceMembership node fragments and
 * `membership_of` / `membership_in` edges, which are written only by FDN-85's
 * privileged projection command. `denied` and `unsupported` stay distinct: a denial is an answer
 * about who the caller is, an unsupported result is about what can be
 * committed at all.
 */
export type RuntimeMutationOutcome =
  | ({ readonly status: "applied" } & RuntimeDeltaBatchResult)
  | { readonly status: "denied"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "invalid"; readonly reason: string };

/**
 * FDN-50 stage 2: how long an in-memory mutation can sit before it is
 * durably flushed to SealedStore. Chosen in the low hundreds of
 * milliseconds, not seconds, specifically to bound the data-loss window
 * described on `#persist` below to something a founder reviewing this
 * tradeoff would recognize as "a moment," not "noticeable work lost." 250ms
 * is long enough that a burst of rapid edits (drag, fast typing, a bulk
 * paste materializing as several small delta batches) coalesces into one
 * flush rather than one write per keystroke, while staying well clear of
 * the "seconds" range the decision memo ruled out. It is not read from
 * VPS-D003 or VPS-A003 — neither specifies a debounce window, only the 16ms
 * optimistic write-acknowledgment budget this value does not touch, since
 * the in-memory mutation is visible immediately in `applyDeltaBatch` and
 * only the durable flush is deferred.
 */
const FLUSH_DEBOUNCE_MS = 250;

/**
 * F144. What happened to this device's local state when its authority ended.
 *
 * Returned rather than inferred, because the whole finding was that a caller
 * could not tell "your store locked" from "your store locked and writes were
 * discarded" — both arrived as the same fixed string.
 */
export interface LocalSessionEndOutcome {
  /** A durability window was open when authority ended. */
  readonly hadPendingWindow: boolean;
  /** That window reached disk before the store locked. */
  readonly flushed: boolean;
  /** That window did NOT reach disk and its writes are gone. */
  readonly discardedWrites: boolean;
  /** Why, when `discardedWrites` is true. */
  readonly discardReason?: string;
  /** The in-memory plaintext document and materialized index were released. */
  readonly purged: boolean;
  /**
   * F151. The persisted local store was erased, not merely locked — only
   * true when the server classified this session's end as one of the two
   * named revocation events. False for every ordinary lock, including a
   * denial the server did not or could not classify.
   */
  readonly erased: boolean;
  /** Which of the two events triggered the erase, when `erased` is true. */
  readonly eraseReason?: RoleRefreshDenialReason;
}

/**
 * F144. A durability window that was lost, raised as its own type so the
 * boundary can report it under its own code.
 *
 * Before this, `#pendingFlushError` re-threw the raw `SealedStoreLockedError`,
 * which carries one fixed message and is also what an ordinary locked-store
 * call throws — so the report a caller received after silently losing writes
 * was byte-identical to one where nothing was lost.
 */
export class PendingFlushDiscardedError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "Writes that were acknowledged but not yet durable have been discarded: " +
        (cause instanceof Error ? cause.message : String(cause)),
    );
  }
}

interface Tier1IdentityRecord {
  readonly formatVersion: 1;
  readonly workspaceId: string;
  readonly canonicalUserId: string;
  readonly publicKey: string;
  readonly wrapIv: string;
  readonly wrappedPrivateKey: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    (character) => character.charCodeAt(0),
  );
}

function parseTier1IdentityRecord(bytes: Uint8Array): Tier1IdentityRecord {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unsupported Tier 1 identity record");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "canonicalUserId",
    "formatVersion",
    "publicKey",
    "workspaceId",
    "wrapIv",
    "wrappedPrivateKey",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    record.formatVersion !== 1 ||
    typeof record.workspaceId !== "string" ||
    record.workspaceId.length === 0 ||
    typeof record.canonicalUserId !== "string" ||
    record.canonicalUserId.length === 0 ||
    typeof record.publicKey !== "string" ||
    typeof record.wrapIv !== "string" ||
    typeof record.wrappedPrivateKey !== "string"
  ) {
    throw new Error("Unsupported Tier 1 identity record");
  }
  if (decodeBase64Url(record.wrapIv).byteLength !== 12) {
    throw new Error("Malformed Tier 1 identity wrap IV");
  }
  return record as unknown as Tier1IdentityRecord;
}

/** A standalone `ArrayBuffer` holding exactly `bytes` — `#commitDeltaBatch` takes `ArrayBuffer`. */
function bufferOfExact(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function serializeTier1IdentityRecord(record: Tier1IdentityRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

export class LocalGraphWorkerRuntime {
  #availability: GraphAvailability = { state: "mid-sync" };
  #document: LoroDoc | null = null;
  // FDN-52 Stage 3: separate from the Tier 0/2 workspace document by construction.
  #protectedPartitions = new ProtectedPartitionRegistry();
  #tier3Partitions = new Tier3PartitionRegistry();
  #protectedVersion: Pick<SealedStoreVersionedValue, "generation" | "digest"> | null =
    null;
  #tier3Version: Pick<SealedStoreVersionedValue, "generation" | "digest"> | null = null;
  #pendingTier3Proposal: Tier3PartitionRegistry | null = null;
  #tier1Identity: {
    readonly canonicalUserId: string;
    readonly publicKey: CryptoKey;
    readonly privateKey: CryptoKey;
    readonly record: Tier1IdentityRecord;
    readonly version: SealedStoreCommit;
  } | null = null;
  #pendingTier1TransferTargets = new Map<
    string,
    {
      readonly canonicalUserId: string;
      readonly sourceDeviceId: string;
      readonly targetDeviceId: string;
      readonly keyPair: CryptoKeyPair;
    }
  >();
  #index: SQLiteGraphIndex | null = null;
  #workspaceId: string | null = null;
  /**
   * Every new Worker instance starts with a fresh, locked SealedStore.
   * There is no mechanism anywhere in this class that carries an unlocked
   * state from a prior instance — a cold restart, browser restart, or a
   * plain tab reload always requires unlockSealedStore() again.
   */
  #sealedStore = new SealedStore();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #flushInFlight: Promise<void> | null = null;
  /**
   * A flush that fires from the debounce timer (not from `dispose()`'s
   * synchronous drain) runs with nothing awaiting it. If it fails — for
   * example the sealed store was locked in between the mutation and the
   * timer firing — that failure must not vanish silently. It is captured
   * here and re-thrown at the start of the next `applyDeltaBatch` or
   * `dispose()` call, so a caller always eventually observes it instead of
   * the runtime quietly continuing to accept mutations it cannot persist.
   */
  #pendingFlushError: unknown = null;
  /**
   * F138's containment half. Set when a materialization refuses a batch that
   * had already been merged into the in-memory document — at which point the
   * document and the durable snapshot have diverged, and the document is the
   * one that is wrong.
   *
   * `#persist` exports the document's CURRENT state at flush time, not the
   * state captured when the flush was scheduled. So without this flag an
   * already-pending flush would happily carry a known-bad document out to
   * disk, and the next `initialize()` would refuse to open the workspace at
   * all. Refusing to persist keeps the last good snapshot on disk and costs
   * only the in-memory changes that were never valid to begin with.
   *
   * Never cleared. A document that failed to materialize cannot be repaired
   * in place — full re-materialization is a pure function of the whole
   * document, so every later attempt fails identically. The Worker keeps
   * serving reads from its still-coherent index and stops writing; recovery
   * is a reopen, which reads the last good snapshot.
   */
  #materializationFailed = false;
  /** Set on a successful unlock, cleared on lock/dispose. Reused by the role-refresh poll below, never persisted. */
  #apiOrigin: string | null = null;
  #rolePollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * F144. The outcome of the most recent authority-ending sequence, so the
   * protocol boundary can report a discarded durability window under its own
   * code instead of folding it into the denial's fixed message.
   */
  #lastSessionEnd: LocalSessionEndOutcome | null = null;

  /** FDN-51 Stage 4a. The relay sync client — non-null only while this tab holds sync leadership. */
  #sync: WorkspaceSyncClient | null = null;
  /** True between `startSync` and `stopSync`, whether or not this tab currently leads. */
  #syncActive = false;
  /** Cross-tab sync-leadership arbitration (one Web Lock per workspace+device). */
  #leadership: SyncLeadership | null = null;
  #syncStatus: SyncStatusSnapshot = {
    state: "offline",
    pendingLocalChanges: false,
    highestKnownCursor: 0,
    highestAckedCursor: 0,
    lastError: null,
  };
  #syncStatusListener: ((snapshot: SyncStatusSnapshot) => void) | null = null;

  get availability(): GraphAvailability {
    return this.#availability;
  }

  get workspaceId(): string | null {
    return this.#workspaceId;
  }

  get sealedStoreLocked(): boolean {
    return !this.#sealedStore.isUnlocked;
  }

  /** F144. Null until this device's authority has ended at least once. */
  get lastSessionEnd(): LocalSessionEndOutcome | null {
    return this.#lastSessionEnd;
  }

  /**
   * FDN-87. `VPS-F001` G04's erase, exposed on the runtime so the
   * orchestration FDN-63 builds has something to call. Not wired to any
   * signal here — see `#endLocalSession` for why the role-refresh denial is
   * not that signal.
   */
  async eraseLocalStore(workspaceId: string): Promise<void> {
    await this.#sealedStore.erase(workspaceId);
    // Erasing the disk while leaving a fully materialized plaintext index of
    // the same workspace resident would satisfy the letter of "wipe" and
    // none of its purpose. FDN-84's criterion is that revocation makes local
    // graph data unavailable, not merely that a file is gone.
    if (this.#workspaceId === workspaceId) {
      await this.#purgeInMemoryState();
    }
  }

  /** The role set the permission interceptor currently reads. Throws when locked, same as `SealedStore.roles`. */
  get roles(): readonly WorkspaceRole[] {
    return this.#sealedStore.roles;
  }

  /**
   * FDN-50 stage 5: Worker-private access to the materialized index, for
   * the proof seam that has to read back what the live path wrote.
   *
   * This is NOT an application-facing read path and does not become one.
   * `packages/graph`'s public surface is the Worker client and its
   * validated protocol; no protocol message reaches this getter, `entry.ts`
   * never calls it, and nothing outside the Worker can obtain a
   * `LocalGraphWorkerRuntime` to call it on. Per F105, FDN-53 remains the
   * first application-callable read path over graph state, behind
   * `VPS-A004`'s permission interceptor — this getter is the same category
   * of test seam as stage 4's materializer, reached only from
   * `src/worker/testing/`.
   *
   * Named for what it is so that adding a protocol message that exposes it
   * reads as the deliberate scope violation it would be.
   */
  get materializedIndexForDiagnostics(): SQLiteGraphIndex | null {
    return this.#index;
  }

  /** Worker-test seam only; no protocol exposes protected plaintext or keys. */
  get protectedPartitionsForDiagnostics(): ProtectedPartitionRegistry {
    return this.#protectedPartitions;
  }

  /** Worker-test seam only; no protocol exposes Tier 3 plaintext, roots or codes. */
  get tier3PartitionsForDiagnostics(): Tier3PartitionRegistry {
    return this.#tier3Partitions;
  }

  /** Creates or restores the one user/workspace Tier 1 identity generation. */
  async initializeTier1Identity(canonicalUserId: string): Promise<CryptoKey> {
    const workspaceId = this.#requireWorkspaceId();
    if (this.#tier1Identity !== null) {
      if (this.#tier1Identity.canonicalUserId !== canonicalUserId) {
        throw new Error("This Worker already holds another Tier 1 identity");
      }
      return this.#tier1Identity.publicKey;
    }
    const storeKey = tier1IdentityStoreKey(workspaceId, canonicalUserId);
    const existing = await this.#sealedStore.getVersioned(storeKey);
    if (existing.value !== null) {
      return this.#restoreTier1IdentityFromRecord(canonicalUserId, existing);
    }

    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const record: Tier1IdentityRecord = {
      formatVersion: 1,
      workspaceId,
      canonicalUserId,
      publicKey: await exportP256PublicKey(pair.publicKey),
      wrapIv: encodeBase64Url(wrapIv),
      wrappedPrivateKey: encodeBase64Url(
        await this.#sealedStore.wrapPrivateKey(pair.privateKey, wrapIv),
      ),
    };
    let version: SealedStoreCommit;
    try {
      version = await this.#sealedStore.compareAndSwap(
        storeKey,
        serializeTier1IdentityRecord(record),
        { generation: -1, digest: null },
      );
    } catch (error) {
      if (!(error instanceof SealedStoreConflictError)) throw error;
      const winner = await this.#sealedStore.getVersioned(storeKey);
      if (winner.value === null) throw error;
      return this.#restoreTier1IdentityFromRecord(canonicalUserId, winner);
    }
    const privateKey = await this.#sealedStore.unwrapPrivateKey(
      decodeBase64Url(record.wrappedPrivateKey),
      wrapIv,
      false,
    );
    this.#tier1Identity = {
      canonicalUserId,
      publicKey: pair.publicKey,
      privateKey,
      record,
      version,
    };
    return pair.publicKey;
  }

  /** Normal cold-reopen path: no generation occurs when a sealed identity exists. */
  async restoreTier1Identity(canonicalUserId: string): Promise<CryptoKey> {
    const workspaceId = this.#requireWorkspaceId();
    const versioned = await this.#sealedStore.getVersioned(
      tier1IdentityStoreKey(workspaceId, canonicalUserId),
    );
    if (versioned.value === null) throw new Error("Tier 1 identity does not exist");
    return this.#restoreTier1IdentityFromRecord(canonicalUserId, versioned);
  }

  get tier1IdentityCredentialForDiagnostics(): ProtectedReaderCredential | null {
    const identity = this.#tier1Identity;
    return identity === null
      ? null
      : { userId: identity.canonicalUserId, privateKey: identity.privateKey };
  }

  get tier1IdentityPublicKeyForDiagnostics(): CryptoKey | null {
    return this.#tier1Identity?.publicKey ?? null;
  }

  async deviceIdForDiagnostics(): Promise<string> {
    return this.#sealedStore.deviceId();
  }

  async beginTier1IdentityTransferTarget(input: {
    readonly canonicalUserId: string;
    readonly sourceDeviceId: string;
    readonly transferId: string;
  }): Promise<{
    readonly targetDeviceId: string;
    readonly targetTransferPublicKey: string;
  }> {
    this.#requireWorkspaceId();
    if (this.#pendingTier1TransferTargets.has(input.transferId)) {
      throw new Error("Tier 1 transfer target already exists");
    }
    const keyPair = await generateTier1TransferKeyPair();
    const targetDeviceId = await this.#sealedStore.deviceId();
    this.#pendingTier1TransferTargets.set(input.transferId, {
      canonicalUserId: input.canonicalUserId,
      sourceDeviceId: input.sourceDeviceId,
      targetDeviceId,
      keyPair,
    });
    return {
      targetDeviceId,
      targetTransferPublicKey: await exportP256PublicKey(keyPair.publicKey),
    };
  }

  async createTier1IdentityTransfer(input: {
    readonly canonicalUserId: string;
    readonly targetDeviceId: string;
    readonly targetTransferPublicKey: string;
    readonly transferId: string;
    readonly expiresAt: string;
  }): Promise<Tier1IdentityTransferPayload> {
    const workspaceId = this.#requireWorkspaceId();
    const identity = this.#tier1Identity;
    if (identity === null || identity.canonicalUserId !== input.canonicalUserId) {
      throw new Error("Tier 1 identity is not operational for this user");
    }
    const transientPrivateKey = await this.#sealedStore.unwrapPrivateKey(
      decodeBase64Url(identity.record.wrappedPrivateKey),
      decodeBase64Url(identity.record.wrapIv),
      true,
    );
    return createTier1IdentityTransfer({
      identityPrivateKey: transientPrivateKey,
      identityPublicKey: identity.publicKey,
      targetTransferPublicKey: await importP256PublicKey(input.targetTransferPublicKey),
      workspaceId,
      canonicalUserId: input.canonicalUserId,
      sourceDeviceId: await this.#sealedStore.deviceId(),
      targetDeviceId: input.targetDeviceId,
      transferId: input.transferId,
      expiresAt: input.expiresAt,
    });
  }

  async acceptTier1IdentityTransfer(input: {
    readonly payload: Tier1IdentityTransferPayload;
    readonly transferId: string;
    readonly now: string;
  }): Promise<CryptoKey> {
    const workspaceId = this.#requireWorkspaceId();
    const pending = this.#pendingTier1TransferTargets.get(input.transferId);
    if (!pending) throw new Error("Tier 1 transfer is unknown or already consumed");
    const parsedPayload = tier1IdentityTransferPayloadSchema.parse(input.payload);
    const opened = await openTier1IdentityTransfer({
      payload: parsedPayload,
      targetTransferPrivateKey: pending.keyPair.privateKey,
      expectedWorkspaceId: workspaceId,
      expectedCanonicalUserId: pending.canonicalUserId,
      expectedSourceDeviceId: pending.sourceDeviceId,
      expectedTargetDeviceId: pending.targetDeviceId,
      expectedTransferId: input.transferId,
      expectedTargetTransferPublicKey: pending.keyPair.publicKey,
      now: input.now,
      extractable: true,
    });
    const storeKey = tier1IdentityStoreKey(workspaceId, pending.canonicalUserId);
    const existing = await this.#sealedStore.getVersioned(storeKey);
    if (existing.value !== null) {
      throw new Error("Tier 1 identity already exists; transfer is a replay");
    }
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const record: Tier1IdentityRecord = {
      formatVersion: 1,
      workspaceId,
      canonicalUserId: pending.canonicalUserId,
      publicKey: parsedPayload.header.sourceIdentityPublicKey,
      wrapIv: encodeBase64Url(wrapIv),
      wrappedPrivateKey: encodeBase64Url(
        await this.#sealedStore.wrapPrivateKey(opened.privateKey, wrapIv),
      ),
    };
    let version: SealedStoreCommit;
    try {
      version = await this.#sealedStore.compareAndSwap(
        storeKey,
        serializeTier1IdentityRecord(record),
        { generation: -1, digest: null },
      );
    } catch (error) {
      if (error instanceof SealedStoreConflictError) {
        throw new Error("Tier 1 identity transfer lost a one-time install race");
      }
      throw error;
    }
    const operationalPrivateKey = await this.#sealedStore.unwrapPrivateKey(
      decodeBase64Url(record.wrappedPrivateKey),
      wrapIv,
      false,
    );
    this.#tier1Identity = {
      canonicalUserId: pending.canonicalUserId,
      publicKey: opened.sourceIdentityPublicKey,
      privateKey: operationalPrivateKey,
      record,
      version,
    };
    this.#pendingTier1TransferTargets.delete(input.transferId);
    return opened.sourceIdentityPublicKey;
  }

  async #restoreTier1IdentityFromRecord(
    canonicalUserId: string,
    versioned: SealedStoreVersionedValue,
  ): Promise<CryptoKey> {
    const workspaceId = this.#requireWorkspaceId();
    if (versioned.value === null || versioned.digest === null) {
      throw new Error("Tier 1 identity does not exist");
    }
    const record = parseTier1IdentityRecord(versioned.value);
    if (
      record.workspaceId !== workspaceId ||
      record.canonicalUserId !== canonicalUserId
    ) {
      throw new Error("Tier 1 identity record does not match this Worker");
    }
    const publicKey = await importP256PublicKey(record.publicKey);
    const privateKey = await this.#sealedStore.unwrapPrivateKey(
      decodeBase64Url(record.wrappedPrivateKey),
      decodeBase64Url(record.wrapIv),
      false,
    );
    await assertP256KeyPair(privateKey, publicKey);
    this.#tier1Identity = {
      canonicalUserId,
      publicKey,
      privateKey,
      record,
      version: { generation: versioned.generation, digest: versioned.digest },
    };
    return publicKey;
  }

  async beginTier3Enrollment(input: {
    readonly address: ProtectedDocumentAddress;
    readonly sessionUserId: string;
    readonly credentialId: string;
    readonly prfInput: Uint8Array;
    readonly prfResult: Uint8Array;
  }): Promise<string> {
    this.#requireAddressWorkspace(input.address);
    if (this.#pendingTier3Proposal !== null) {
      throw new Error("A Tier 3 ceremony is already pending");
    }
    await this.#ensureTier3Version(true);
    const proposal = this.#tier3Partitions.fork();
    try {
      const code = await proposal.beginEnrollment(input);
      this.#pendingTier3Proposal = proposal;
      return code;
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async confirmTier3Enrollment(recoveryCode: string): Promise<void> {
    const proposal = this.#pendingTier3Proposal;
    if (proposal === null) throw new Error("No Tier 3 enrollment awaits confirmation");
    proposal.confirmEnrollment(recoveryCode);
    try {
      await this.#commitTier3Proposal(proposal);
      this.#pendingTier3Proposal = null;
    } catch (error) {
      proposal.dispose();
      this.#pendingTier3Proposal = null;
      throw error;
    }
  }

  async addTier3Document(
    rootAddress: Tier3RootAddress,
    address: ProtectedDocumentAddress,
  ): Promise<void> {
    this.#requireRootWorkspace(rootAddress);
    this.#requireAddressWorkspace(address);
    const proposal = this.#tier3Partitions.fork();
    try {
      await proposal.addDocument(rootAddress, address);
      await this.#commitTier3Proposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async persistTier3Partitions(): Promise<void> {
    const workspaceId = this.#requireWorkspaceId();
    await this.#ensureTier3Version(false);
    const commit = await this.#sealedStore.compareAndSwap(
      tier3PartitionManifestStoreKey(workspaceId),
      await this.#tier3Partitions.serialize(),
      this.#tier3Version!,
    );
    this.#tier3Version = commit;
    await this.#materialize();
  }

  async restoreTier3Partitions(input: {
    readonly sessionUserId: string;
    readonly credentialId: string;
    readonly prfResult: Uint8Array;
  }): Promise<void> {
    const workspaceId = this.#requireWorkspaceId();
    const versioned = await this.#sealedStore.getVersioned(
      tier3PartitionManifestStoreKey(workspaceId),
    );
    this.#tier3Version = {
      generation: versioned.generation,
      digest: versioned.digest,
    };
    if (versioned.value === null) return;
    await this.#tier3Partitions.restore(versioned.value, {
      ...input,
      expectedWorkspaceId: workspaceId,
    });
    await this.#materialize();
  }

  async recoverTier3Partitions(input: {
    readonly sessionUserId: string;
    readonly credentialId: string;
    readonly prfInput: Uint8Array;
    readonly prfResult: Uint8Array;
    readonly recoveryCode: string;
  }): Promise<string> {
    const workspaceId = this.#requireWorkspaceId();
    const versioned = await this.#sealedStore.getVersioned(
      tier3PartitionManifestStoreKey(workspaceId),
    );
    if (versioned.value === null)
      throw new Error("Tier 3 durable state does not exist");
    if (this.#pendingTier3Proposal !== null) {
      throw new Error("A Tier 3 ceremony is already pending");
    }
    this.#tier3Version = {
      generation: versioned.generation,
      digest: versioned.digest,
    };
    const proposal = new Tier3PartitionRegistry();
    try {
      const code = await proposal.recover(versioned.value, {
        ...input,
        expectedWorkspaceId: workspaceId,
      });
      this.#pendingTier3Proposal = proposal;
      return code;
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async confirmTier3Recovery(recoveryCode: string): Promise<void> {
    const proposal = this.#pendingTier3Proposal;
    if (proposal === null) throw new Error("No Tier 3 recovery awaits confirmation");
    proposal.confirmRecovery(recoveryCode);
    try {
      await this.#commitTier3Proposal(proposal);
      this.#pendingTier3Proposal = null;
    } catch (error) {
      proposal.dispose();
      this.#pendingTier3Proposal = null;
      throw error;
    }
  }

  async createProtectedPartition(
    address: ProtectedDocumentAddress,
    recipients: readonly Tier1Recipient[],
    retention?: Tier1RetentionState,
  ): Promise<void> {
    this.#requireAddressWorkspace(address);
    const proposal = this.#protectedPartitions.fork();
    try {
      await proposal.create(address, recipients, retention);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async removeProtectedReader(input: {
    readonly address: ProtectedDocumentAddress;
    readonly nextAddress: ProtectedDocumentAddress;
    readonly removedUserId: string;
    readonly remainingRecipients: readonly Tier1Recipient[];
  }): Promise<void> {
    this.#requireAddressWorkspace(input.address);
    this.#requireAddressWorkspace(input.nextAddress);
    const proposal = this.#protectedPartitions.fork();
    try {
      await proposal.removeReader(input);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async addProtectedReader(input: {
    readonly address: ProtectedDocumentAddress;
    readonly nextAddress: ProtectedDocumentAddress;
    readonly addedUserId: string;
    readonly nextRecipients: readonly Tier1Recipient[];
    readonly authorizingCredential: ProtectedReaderCredential;
  }): Promise<void> {
    this.#requireAddressWorkspace(input.address);
    this.#requireAddressWorkspace(input.nextAddress);
    const proposal = this.#protectedPartitions.fork();
    try {
      await proposal.addReader(input);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  /**
   * FDN-52/F167 — establishes (or replaces) the no-device recovery envelope
   * for one protected partition, under F173's fork-then-commit discipline
   * like every other protected-partition mutation.
   */
  async establishProtectedRecovery(input: {
    readonly address: ProtectedDocumentAddress;
    readonly recoverySecret: Uint8Array;
  }): Promise<void> {
    this.#requireAddressWorkspace(input.address);
    const proposal = this.#protectedPartitions.fork();
    try {
      await proposal.establishRecovery(input);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  /**
   * FDN-52/F167 — no-device recovery. Authorized by the recovery envelope
   * (unwrapped from a secret reconstructed from any two of three Shamir
   * shares), never by an existing device credential. Same fork-then-commit
   * discipline as `addProtectedReader`/`removeProtectedReader`.
   */
  async recoverProtectedPartition(input: {
    readonly address: ProtectedDocumentAddress;
    readonly recoverySecret: Uint8Array;
    readonly nextAddress: ProtectedDocumentAddress;
    readonly nextRecipients: readonly Tier1Recipient[];
  }): Promise<void> {
    this.#requireAddressWorkspace(input.address);
    this.#requireAddressWorkspace(input.nextAddress);
    const proposal = this.#protectedPartitions.fork();
    try {
      await proposal.recoverPartition(input);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  /**
   * FDN-52's document-scoped handoff for a device that has lost access to
   * one protected partition. This deliberately cannot reach FDN-63's
   * workspace-wide eraseLocalStore path.
   */
  async purgeProtectedPartition(address: ProtectedDocumentAddress): Promise<void> {
    this.#requireAddressWorkspace(address);
    const proposal = this.#protectedPartitions.fork();
    try {
      proposal.purge(address);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async persistProtectedPartitions(): Promise<void> {
    await this.#persistProtectedPartitions();
    await this.#materialize();
  }

  async restoreProtectedPartitions(
    credentials: readonly ProtectedReaderCredential[],
    options?: {
      readonly now?: string;
      readonly onDemandPartitionKeys?: readonly string[];
    },
  ): Promise<void> {
    const workspaceId = this.#requireWorkspaceId();
    const persisted = await this.#sealedStore.getVersioned(
      protectedPartitionManifestStoreKey(workspaceId),
    );
    this.#protectedVersion = {
      generation: persisted.generation,
      digest: persisted.digest,
    };
    if (persisted.value === null) return;
    await this.#protectedPartitions.restore(persisted.value, credentials, {
      ...options,
      expectedWorkspaceId: workspaceId,
    });
    await this.#materialize();
  }

  async configureProtectedRetention(
    address: ProtectedDocumentAddress,
    retention: Tier1RetentionState,
  ): Promise<void> {
    this.#requireAddressWorkspace(address);
    const proposal = this.#protectedPartitions.fork();
    try {
      proposal.configureRetention(address, retention);
      await this.#commitProtectedProposal(proposal);
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async purgeExpiredProtectedRetention(now: string): Promise<number> {
    this.#requireWorkspaceId();
    const proposal = this.#protectedPartitions.fork();
    try {
      const purged = await proposal.purgeExpiredRetention(now);
      await this.#commitProtectedProposal(proposal);
      return purged;
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async cryptographicallyEraseProtectedDomain(
    erasureDomainId: string,
  ): Promise<number> {
    this.#requireWorkspaceId();
    const proposal = this.#protectedPartitions.fork();
    try {
      const erased =
        await proposal.cryptographicallyEraseErasureDomain(erasureDomainId);
      await this.#commitProtectedProposal(proposal);
      return erased;
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async cryptographicallyEraseTier3Domain(erasureDomainId: string): Promise<number> {
    this.#requireWorkspaceId();
    const proposal = this.#tier3Partitions.fork();
    try {
      const erased =
        await proposal.cryptographicallyEraseErasureDomain(erasureDomainId);
      await this.#commitTier3Proposal(proposal);
      return erased;
    } catch (error) {
      proposal.dispose();
      throw error;
    }
  }

  async unlockSealedStore(workspaceId: string, apiOrigin: string): Promise<void> {
    if (this.#workspaceId !== null && this.#workspaceId !== workspaceId) {
      throw new Error(
        "The Worker cannot unlock a different workspace while initialized",
      );
    }
    await this.#sealedStore.unlockOnline(workspaceId, apiOrigin);
    this.#apiOrigin = apiOrigin;
    // F149. A successful online unlock is the server re-authorizing this
    // device — whatever ended the previous session is resolved. Clear the
    // stale outcome so a `not-initialized` between this unlock and the next
    // `initialize()` reports as never-initialized, not as the old revocation.
    this.#lastSessionEnd = null;
    this.#startRolePolling(workspaceId);
  }

  lockSealedStore(): void {
    this.#stopRolePolling();
    this.#stopSyncInternal();
    this.#sealedStore.lock();
    this.#apiOrigin = null;
  }

  /**
   * F127's live role-refresh entrypoint. Re-validates against the server
   * (`POST /device-store/roles`, reusing `requireCurrentWorkspaceSession`'s
   * exact revalidation) and updates the in-memory role set the interceptor
   * reads — no full re-`unlock()`, no re-derivation of the AES key. Called
   * directly by the `refresh-role` protocol message and, on a timer, by the
   * placeholder poll started in `unlockSealedStore` above.
   *
   * A denial (membership revoked, session invalid) locks the store: this
   * stage does not build a distinct "role became unresolvable while
   * otherwise online" state, and a device that can no longer prove its
   * session current should not keep serving reads from the role it cached
   * before that became true.
   */
  async refreshRoleOnline(workspaceId: string): Promise<void> {
    const apiOrigin = this.#apiOrigin;
    if (apiOrigin === null) throw new SealedStoreLockedError();
    try {
      const deviceId = await this.#sealedStore.deviceId();
      const result = await fetchCurrentRoles(apiOrigin, workspaceId, deviceId);
      this.#sealedStore.refreshRoles(result.roles);
    } catch (error) {
      // F148: only an authoritative denial ends the session. A checkpoint
      // that could not answer (`RoleRefreshUnavailableError`) changes
      // nothing — the roles simply stay stale until it can.
      if (error instanceof RoleRefreshDeniedError) {
        this.#lastSessionEnd = await this.#endLocalSession(error.reason);
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // FDN-51 Stage 4a — relay synchronization.
  //
  // The sync client runs here, in the Worker, next to the document and the
  // sealed store (founder ruling). It pushes local commits to the relay,
  // applies remote ones through the SAME un-gated merge path as any other
  // delta (`#commitDeltaBatch`) — remote deltas are NOT re-run through
  // VPS-A004 Gate 1, because access is decided only by the read interceptor
  // (founder ruling 3) — and exposes a `SyncStatus` observable.
  // -------------------------------------------------------------------------

  setSyncStatusListener(
    listener: ((snapshot: SyncStatusSnapshot) => void) | null,
  ): void {
    this.#syncStatusListener = listener;
  }

  getSyncStatus(): SyncStatusSnapshot {
    return this.#syncStatus;
  }

  /**
   * FDN-51 Stage 4a — start relay synchronization for this workspace.
   *
   * Leadership is arbitrated across tabs by [`SyncLeadership`]: one exclusive
   * `navigator.locks` lock per `(workspace, device)` (see that module for
   * why). The tab that holds it runs the client; the others queue with the
   * status `offline` and take over when the holder releases — on `stopSync`,
   * or when the tab closes and the browser frees the lock. Full multi-tab
   * live convergence is out of scope (FDN-90).
   */
  async startSync(relayUrl: string): Promise<void> {
    if (this.#syncActive) return;
    const workspaceId = this.#requireWorkspaceId();
    this.#requireDocument();
    this.#requireIndex();
    if (this.#apiOrigin === null) throw new SealedStoreLockedError();
    const deviceId = await this.#sealedStore.deviceId();

    this.#syncActive = true;
    // Queued (or about to lead) — report offline until the client says otherwise.
    this.#emitSyncStatus({
      state: "offline",
      pendingLocalChanges: false,
      highestKnownCursor: 0,
      highestAckedCursor: 0,
      lastError: null,
    });

    this.#leadership = new SyncLeadership(
      `vulto-sync:${workspaceId}:${deviceId}`,
      async () => {
        this.#sync = this.#buildSyncClient(relayUrl, deviceId);
        await this.#sync.start();
        return async () => {
          const sync = this.#sync;
          this.#sync = null;
          await sync?.stop();
        };
      },
      (globalThis.navigator as Navigator | undefined)?.locks,
    );
    this.#leadership.start();
  }

  #buildSyncClient(relayUrl: string, deviceId: string): WorkspaceSyncClient {
    const workspaceId = this.#requireWorkspaceId();
    const apiOrigin = this.#apiOrigin;
    if (apiOrigin === null) throw new SealedStoreLockedError();
    return new WorkspaceSyncClient({
      relayUrl,
      bindings: {
        workspaceId,
        deviceId,
        documentId: WORKSPACE_GRAPH_DOCUMENT_ID,
        applyRemoteDeltas: async (payloads) => {
          await this.#commitDeltaBatch(payloads.map((p) => bufferOfExact(p)));
        },
        loadMarker: (key) =>
          this.#sealedStore.get(syncMarkerStoreKey(workspaceId, key)),
        storeMarker: (key, value) =>
          this.#sealedStore.put(syncMarkerStoreKey(workspaceId, key), value),
        mintTicket: async () => {
          const response = await fetch(`${apiOrigin}/sync/ticket`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspaceId, deviceId }),
          });
          if (!response.ok) throw new Error("sync ticket denied");
          const grant = (await response.json()) as {
            ticket: string;
            expiresAt: string;
          };
          return { ticket: grant.ticket, expiresAtMs: Date.parse(grant.expiresAt) };
        },
      },
      onStatusChange: (snapshot) => this.#emitSyncStatus(snapshot),
    });
  }

  #emitSyncStatus(snapshot: SyncStatusSnapshot): void {
    this.#syncStatus = snapshot;
    this.#syncStatusListener?.(snapshot);
  }

  async stopSync(): Promise<void> {
    if (!this.#syncActive) return;
    this.#syncActive = false;
    const leadership = this.#leadership;
    this.#leadership = null;
    await leadership?.stop();
    this.#sync = null;
    this.#emitSyncStatus({
      state: "offline",
      pendingLocalChanges: false,
      highestKnownCursor: 0,
      highestAckedCursor: 0,
      lastError: null,
    });
  }

  /** Fire-and-forget teardown for the lock / purge / dispose paths. */
  #stopSyncInternal(): void {
    void this.stopSync();
  }

  /**
   * F144 + F145. What happens on this device when its authority ends, in the
   * one order that is defensible — and each step exists because reproducing
   * S1 showed the alternative was wrong.
   *
   *   1. **Flush the open durability window, while still authorized.** At the
   *      instant before the lock this device's writes were legitimate; the
   *      user was told they were `applied`. F139 already ruled that a clean,
   *      deliberate transition flushes its window rather than killing it, and
   *      a revocation arriving is exactly that shape of event from this
   *      device's side. Doing this after the lock is impossible — the store
   *      refuses — which is why the order matters rather than reads as taste.
   *   2. **Lock.** Key and roles dropped, as before.
   *   3. **Purge the in-memory plaintext.** F145: `lock()` alone dropped the
   *      key and the role set — the small half — and left a fully
   *      materialized plaintext index of the whole workspace and the Loro
   *      document behind it resident in the Worker.
   *
   * **Purging returns the runtime to its pre-`initialize()` state**, rather
   * than inventing a fourth lifecycle condition. A device that legitimately
   * regains access re-unlocks and re-initializes, which reads the last good
   * snapshot from disk — including step 1's flush.
   *
   * **This is NOT what an ordinary `lockSealedStore()` does, deliberately.**
   * A plain lock is a recoverable, possibly routine event (a future idle
   * lock), and a purge would make every one of them cost a full
   * re-materialization. F148 was caused by treating an ambiguous event as a
   * security event; firing a purge on every lock would be the same mistake
   * pointing the other way. The paired tests hold that line.
   *
   * **Step 4, F151: erase the persisted store, but only on a classified
   * reason.** `eraseReason` is `undefined` for the overwhelming majority of
   * denials — an unreachable server, a merely-expired session, anything the
   * server did not or could not positively confirm as one of the two named
   * revocation events (`VPS-F001`'s single-device Revoke action, or a
   * membership revocation/offboarding under A003-T16). Only those two values
   * reach this far; every other denial purges memory (steps 1–3) and stops
   * there, identically to how this method behaved before F151 existed.
   *
   * Ordered after the purge, not before: erasing disk while a stale
   * in-memory index still pointed at it would risk a caller reading through
   * the purge before the erase completed. Purge-then-erase makes the
   * in-memory state already gone by the time the disk write starts.
   */
  async #endLocalSession(
    eraseReason?: RoleRefreshDenialReason,
  ): Promise<LocalSessionEndOutcome> {
    const workspaceId = this.#workspaceId;
    const hadPendingWindow = this.#flushTimer !== null || this.#flushInFlight !== null;

    // 1. Flush, while the key still exists. `#flushBeforeTeardown` captures
    //    its own failures into `#pendingFlushError` rather than throwing, so
    //    a failed flush cannot abandon the lock that must follow it.
    if (this.#document !== null) {
      await this.#flushBeforeTeardown();
    }
    const discardedWrites = hadPendingWindow && this.#pendingFlushError !== null;
    const discardReason = discardedWrites
      ? this.#pendingFlushError instanceof Error
        ? this.#pendingFlushError.message
        : String(this.#pendingFlushError)
      : undefined;

    // 2. Lock.
    this.lockSealedStore();

    // 3. Purge the plaintext this device is no longer entitled to hold.
    await this.#purgeInMemoryState();

    // 4. Erase, only when the server positively classified why.
    const erased = eraseReason !== undefined && workspaceId !== null;
    if (erased) {
      await this.#sealedStore.erase(workspaceId!);
    }

    return {
      hadPendingWindow,
      flushed: hadPendingWindow && !discardedWrites,
      discardedWrites,
      discardReason,
      purged: true,
      erased,
      eraseReason: erased ? eraseReason : undefined,
    };
  }

  #startRolePolling(workspaceId: string): void {
    this.#stopRolePolling();
    this.#rolePollTimer = setInterval(() => {
      // A poll tick's own failure (network blip while offline, or a
      // transient server error) must not crash the Worker or stop future
      // ticks — F106/F127 already treat offline staleness as expected,
      // resolved on next connection. A genuine denial is handled inside
      // refreshRoleOnline itself (locks the store), so nothing further is
      // needed here beyond not letting a rejected promise go unobserved.
      void this.refreshRoleOnline(workspaceId).catch(() => {});
    }, ROLE_REFRESH_POLL_INTERVAL_MS);
  }

  #stopRolePolling(): void {
    if (this.#rolePollTimer !== null) {
      clearInterval(this.#rolePollTimer);
      this.#rolePollTimer = null;
    }
  }

  /**
   * FDN-53 stage 1: the first application-callable read path over graph
   * state, per F105. Routes through `executeWithPermissions` rather than
   * `SQLiteGraphIndex.execute()` directly — every production query is
   * permission-filtered, never raw.
   */
  async executeQuery(query: GraphQuery): Promise<GraphQueryResult> {
    const index = this.#requireIndex();
    const roles = deriveEffectiveRoles(this.#sealedStore.roles);
    return executeWithPermissions(index, query, { roles });
  }

  async sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void> {
    await this.#sealedStore.put(storeKey, plaintext);
  }

  async openPayload(storeKey: string): Promise<Uint8Array | null> {
    return this.#sealedStore.get(storeKey);
  }

  async initialize(workspaceId: string): Promise<void> {
    if (this.#workspaceId !== null) {
      throw new Error("The Worker is already bound to a workspace");
    }
    // Fail before touching WASM/index/document state: reading through a
    // locked sealed store is never attempted, silently or otherwise.
    if (!this.#sealedStore.isUnlocked) {
      throw new SealedStoreLockedError();
    }
    if (this.#sealedStore.unlockedWorkspaceId !== workspaceId) {
      throw new SealedStoreEnvelopeMismatchError("workspace");
    }
    this.#availability = { state: "mid-sync" };

    await initializeLoro();
    this.#index = new SQLiteGraphIndex(workspaceId);
    await this.#index.initialize();
    this.#document = new LoroDoc();

    const persisted = await this.#sealedStore.get(graphSnapshotStoreKey(workspaceId));
    if (persisted !== null) {
      this.#document.import(persisted);
      // FDN-50 stage 3: the document-level gate. Runs AFTER the import (the
      // recorded generation is document state, so it cannot be read before
      // the bytes are in) and BEFORE this runtime is usable — nothing has
      // been materialized or bound yet at this point, and if the gate
      // refuses, nothing ever is.
      //
      // A workspace with no persisted snapshot never reaches here at all:
      // that is the bootstrap case, it has no recorded generation by
      // definition, and it initializes cleanly. Its first #persist stamps
      // the current generation.
      try {
        assertDocumentSchemaGenerationReadable(this.#document);
      } catch (error: unknown) {
        // Fail closed, and leave nothing half-open behind. Every resource
        // built above this line is torn down before the refusal propagates,
        // and #workspaceId is deliberately still null — so no delta can be
        // applied, no flush can be scheduled, and #persist cannot run and
        // overwrite the newer document with an older client's snapshot.
        await this.#index.dispose();
        this.#index = null;
        this.#document.free();
        this.#document = null;
        this.#availability = { state: "mid-sync" };
        throw error;
      }
    }

    // FDN-50 stage 5: a reopened document must produce its edges again.
    // The SQLite index is a disposable read model that does not survive the
    // Worker — every new instance starts with an empty one — so a workspace
    // whose Tree moves and node fragments were all merged in a PREVIOUS
    // session would otherwise reopen fully populated as a document and
    // completely empty as a query surface. Materializing here is what makes
    // "closed, reopened, materialized, and queried" one continuous path
    // rather than three that happen to share a document.
    //
    // Its own try/catch rather than an extension of the gate's above: the
    // gate is stage 3's and is deliberately left untouched. The teardown is
    // the same, and for the same reason — a workspace whose document cannot
    // be materialized must not be left half-open, with #workspaceId still
    // null so no delta can be applied and no flush can overwrite it.
    try {
      await this.#materialize();
    } catch (error: unknown) {
      await this.#index.dispose();
      this.#index = null;
      this.#document.free();
      this.#document = null;
      this.#availability = { state: "mid-sync" };
      throw error;
    }

    this.#workspaceId = workspaceId;
    this.#availability = { state: "ready" };
    // F149. A prior session's end outcome is stale once the Worker is serving
    // a workspace again — a device that legitimately re-unlocked and
    // re-initialized after a revocation-then-reinstatement must not report
    // the old revocation on a later `not-initialized` (e.g. after a
    // `switchWorkspace` away).
    this.#lastSessionEnd = null;
  }

  /**
   * FDN-50 stage 5: the whole of the CRDT-to-query-layer mapping, in one
   * place, run on exactly two occasions — a reopen, and every merged delta
   * batch.
   *
   * **This is a full re-materialization, deliberately.** Every call reads
   * the document's complete current state and hands `rebuild` a whole
   * snapshot, which replaces the index's contents outright. An incremental
   * path — diffing which fragments and which Tree subtrees a batch touched,
   * and applying only those — would be faster, and is not built here
   * because it cannot yet be proven correct: a merged CRDT batch can change
   * the resolved winner of a move that the batch itself does not contain
   * (stage 4's concurrent-loser elimination is a property of the whole
   * history, not of one delta), so "which edges changed" is not a function
   * of the incoming bytes alone. A clever incremental path that is wrong in
   * that case would produce a query layer that quietly disagrees with the
   * document, which is precisely the failure this issue exists to rule out.
   *
   * Full re-materialization also makes idempotency free rather than
   * argued: the index becomes a pure function of the document, so running
   * this twice on unchanged state produces an identical index. Stage 4's
   * deterministic edge ids (SHA-256 over replicated inputs, forced to v4
   * shape) are what let that hold across devices as well as across reruns —
   * a random edge id would make the same Tree state materialize as
   * different rows on every pass.
   *
   * The cost is bounded by workspace size rather than batch size, and is
   * paid inside the Worker, never on the main thread (A001-T06). When it
   * stops being acceptable, the replacement needs its own proof, not a
   * quiet substitution.
   */
  async #materialize(): Promise<number> {
    return this.#materializeWith(this.#protectedPartitions, this.#tier3Partitions);
  }

  async #materializeWith(
    protectedPartitions: ProtectedPartitionRegistry,
    tier3Partitions: Tier3PartitionRegistry,
  ): Promise<number> {
    const document = this.#requireDocument();
    const index = this.#requireIndex();
    // FDN-92. `managed_by` is derived one-way from the Movable Tree (F104);
    // every other edge type is stored in `__vulto_edge_fragments` and read
    // back here. Both feed one snapshot — `validateGraphSnapshot` inside
    // `rebuild` treats a generic edge exactly as a Tree-derived one.
    const { edges: managedByEdges } = await materializeManagedByEdges(document);
    return index.rebuild({
      nodeFragments: [
        ...readNodeFragments(document),
        ...protectedPartitions.nodeFragments(),
        ...tier3Partitions.nodeFragments(),
      ],
      edges: [...managedByEdges, ...readEdgeFragments(document)],
    });
  }

  async #ensureProtectedVersion(requireAbsent: boolean): Promise<void> {
    if (this.#protectedVersion !== null) return;
    const workspaceId = this.#requireWorkspaceId();
    const current = await this.#sealedStore.getVersioned(
      protectedPartitionManifestStoreKey(workspaceId),
    );
    if (requireAbsent && current.value !== null) {
      throw new Error("Protected durable state must be restored before mutation");
    }
    this.#protectedVersion = {
      generation: current.generation,
      digest: current.digest,
    };
  }

  async #ensureTier3Version(requireAbsent: boolean): Promise<void> {
    if (this.#tier3Version !== null) return;
    const workspaceId = this.#requireWorkspaceId();
    const current = await this.#sealedStore.getVersioned(
      tier3PartitionManifestStoreKey(workspaceId),
    );
    if (requireAbsent && current.value !== null) {
      throw new Error("Tier 3 durable state must be restored before mutation");
    }
    this.#tier3Version = {
      generation: current.generation,
      digest: current.digest,
    };
  }

  async #commitProtectedProposal(proposal: ProtectedPartitionRegistry): Promise<void> {
    await this.#ensureProtectedVersion(true);
    await this.#materializeWith(proposal, this.#tier3Partitions);
    const workspaceId = this.#requireWorkspaceId();
    try {
      const commit = await this.#sealedStore.compareAndSwap(
        protectedPartitionManifestStoreKey(workspaceId),
        await proposal.serialize(),
        this.#protectedVersion!,
      );
      const previous = this.#protectedPartitions;
      this.#protectedPartitions = proposal;
      this.#protectedVersion = commit;
      previous.dispose();
    } catch (error) {
      await this.#materialize();
      throw error;
    }
  }

  async #commitTier3Proposal(proposal: Tier3PartitionRegistry): Promise<void> {
    await this.#ensureTier3Version(true);
    await this.#materializeWith(this.#protectedPartitions, proposal);
    const workspaceId = this.#requireWorkspaceId();
    try {
      const commit = await this.#sealedStore.compareAndSwap(
        tier3PartitionManifestStoreKey(workspaceId),
        await proposal.serialize(),
        this.#tier3Version!,
      );
      const previous = this.#tier3Partitions;
      this.#tier3Partitions = proposal;
      this.#tier3Version = commit;
      previous.dispose();
    } catch (error) {
      await this.#materialize();
      throw error;
    }
  }

  async #persistProtectedPartitions(): Promise<void> {
    const workspaceId = this.#requireWorkspaceId();
    await this.#ensureProtectedVersion(false);
    const commit = await this.#sealedStore.compareAndSwap(
      protectedPartitionManifestStoreKey(workspaceId),
      await this.#protectedPartitions.serialize(),
      this.#protectedVersion!,
    );
    this.#protectedVersion = commit;
  }

  /**
   * FDN-53 stage 2 (F131). Demoted off `LocalGraphClient`'s public
   * interface, mirroring `SQLiteGraphIndex.execute()`'s treatment exactly —
   * `packages/graph/src/index.ts` does not export a client surface that
   * exposes this method; only `@vulto/graph/testing/unchecked-mutation`
   * does, for the handful of pre-FDN-53 browser proofs (FDN-50's
   * persistence/debounce/materialization harnesses) that need to write
   * synthetic, non-schema-conformant CRDT bytes directly, unchecked, on the
   * SAME Worker instance their other assertions run against. `mutate` below
   * is the real, permission-gated entrypoint every application caller uses
   * instead.
   *
   * This method's OWN behavior is unchanged from before stage 2: it never
   * checked permission and still does not. The gate stage 2 builds lives
   * entirely in `mutate`, ahead of this method, not inside it.
   */
  async applyDeltaBatch(
    deltas: readonly ArrayBuffer[],
  ): Promise<RuntimeDeltaBatchResult> {
    this.#throwPendingFlushError();
    this.#requireDocument();
    this.#requireIndex();
    const committed = await this.#commitDeltaBatch(deltas);
    this.#enqueueLocalDeltasForSync(deltas);
    return committed;
  }

  /**
   * FDN-51 Stage 4a. Hand a locally-authored batch's bytes to the sync
   * outbox, if this tab currently leads sync. NOT called for deltas that
   * arrived from the relay (`applyRemoteDeltas` merges those directly), so a
   * delta is never pushed back to the server it came from.
   */
  #enqueueLocalDeltasForSync(deltas: readonly ArrayBuffer[]): void {
    const sync = this.#sync;
    if (sync === null) return;
    for (const delta of deltas) sync.enqueueLocalDelta(new Uint8Array(delta));
  }

  /**
   * FDN-53 stage 2. The real, `VPS-A004` Gate-1-gated mutation entrypoint
   * (F131) — the first application-callable local WRITE path over graph
   * state, the write-side counterpart to stage 1's `executeQuery`.
   *
   * **Simulate, then diff, then gate.** A delta batch is opaque pre-encoded
   * Loro CRDT bytes; there is no typed "create/update node" call this stage
   * could inspect instead. So the batch is imported into a throwaway
   * `document.fork()` — never the canonical document — and the fork's
   * state is compared against the canonical document's CURRENT state
   * container by container:
   *
   *   1. Any container other than the node-fragment and edge-fragment
   *      containers that differs between before and after — the Movable
   *      Tree, the reserved document-meta container, or anything else a
   *      delta batch could in principle touch — refuses the WHOLE batch as
   *      `unsupported`. Deliberately exhaustive rather than allow-listed to
   *      "the Tree": nothing this function does not explicitly recognize is
   *      permitted to slip through uninspected, the exact failure shape
   *      F131 exists to close. A `managed_by` change is a Tree move and
   *      lands here — it goes through the Tree, not `mutate` (F104).
   *   2. Within the node-fragment container, only the fragments this batch
   *      adds, changes, or removes are gated against Gate 1
   *      (`authorizeNodeWrite`).
   *   3. Within the edge-fragment container (FDN-92), only the edges this
   *      batch adds, changes, or removes are gated against
   *      `authorizeEdgeWrite` — the registry-declared governing partition
   *      (never a delta-supplied value) picks which partition of a split
   *      endpoint governs.
   *   A single denial at 2 or 3 refuses the whole batch; there is no
   *   partial commit.
   *
   * Only once every changed fragment is authorized does this re-import the
   * SAME deltas into the real document and run the ordinary commit path
   * (`#commitDeltaBatch`) — identical materialize/flush behavior to the
   * pre-FDN-53 `applyDeltaBatch`, just gated ahead of it. The fork/diff/gate
   * decision itself is `permission/mutation-interceptor.ts`'s
   * `authorizeMutationBatch`, kept there (not inlined here) so it is
   * directly unit-testable against a real `LoroDoc` without needing this
   * runtime's `SQLiteGraphIndex` (which needs a real browser; see
   * `interceptor.test.ts`'s doc comment).
   */
  async mutate(deltas: readonly ArrayBuffer[]): Promise<RuntimeMutationOutcome> {
    this.#throwPendingFlushError();
    const document = this.#requireDocument();
    this.#requireIndex();
    const roles = deriveEffectiveRoles(this.#sealedStore.roles);

    const authorization = await authorizeMutationBatch(
      document,
      deltas.map((delta) => new Uint8Array(delta)),
      roles,
      this.#requireWorkspaceId(),
    );
    if (authorization.status !== "authorized") return authorization;

    const committed = await this.#commitDeltaBatch(deltas);
    this.#enqueueLocalDeltasForSync(deltas);
    return { status: "applied", ...committed };
  }

  async #commitDeltaBatch(
    deltas: readonly ArrayBuffer[],
  ): Promise<RuntimeDeltaBatchResult> {
    const document = this.#requireDocument();
    this.#availability = { state: "mid-sync" };
    const startedAt = performance.now();

    for (const delta of deltas) {
      document.import(new Uint8Array(delta));
    }
    // FDN-50 stage 5: the merged document is mapped into the SQLite index
    // BEFORE the durable flush is scheduled, so a batch this Worker cannot
    // materialize is never scheduled for a durable write. That ordering is
    // not cosmetic — a batch that reaches disk but cannot be materialized
    // makes the NEXT initialize() refuse the workspace, turning a rejected
    // mutation into an unopenable document.
    //
    // It does not make the in-memory merge conditional: the deltas are
    // already in the document above, and a materialization failure throws
    // out of this call with them merged. That is the honest position for
    // this stage — a CRDT merge is not undoable, and pretending otherwise
    // by discarding the document would lose ops from peers that are
    // perfectly valid. See this stage's report for the case it leaves open.
    let materializationGeneration: number;
    try {
      materializationGeneration = await this.#materialize();
    } catch (error: unknown) {
      // F140. Availability was set to `mid-sync` above and, before this
      // catch existed, a materialization failure escaped without ever
      // restoring it — so every later response reported `mid-sync` forever
      // on a Worker that was otherwise serving queries correctly.
      //
      // `ready` is the honest answer here, not a consolation: `rebuild`
      // validates before it writes and `#commitGeneration` runs inside
      // BEGIN IMMEDIATE/ROLLBACK, so a refused materialization leaves the
      // PREVIOUS generation intact and queryable. The index a caller reads
      // is coherent; it is the in-memory document that now disagrees with
      // it, which is why `#materializationFailed` below stops that document
      // from ever being persisted over the good one.
      this.#availability = { state: "ready" };
      this.#materializationFailed = true;
      if (this.#flushTimer !== null) {
        clearTimeout(this.#flushTimer);
        this.#flushTimer = null;
      }
      throw error;
    }
    // The mutation above is already visible/queryable in-memory and through
    // the index at this point. Only the durable flush to SealedStore is
    // deferred — see #scheduleFlush and #persist.
    this.#scheduleFlush();
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializationGeneration,
      workerDurationMs: performance.now() - startedAt,
    };
  }

  /**
   * FDN-50 stage 2: standard debounce, not a throttle. Every call pushes the
   * pending flush out by FLUSH_DEBOUNCE_MS again; multiple mutations that
   * land inside one window coalesce into a single flush of the document's
   * current state when the window finally elapses with no further activity.
   *
   * A flush scheduled here runs on the timer's own turn, unawaited by the
   * caller that scheduled it (per the 16ms optimistic write-acknowledgment
   * budget: `applyDeltaBatch` returns without waiting on durability). This
   * is the specific tradeoff the decision memo named and the founder
   * accepted: if this device is hard-killed (not a clean `dispose()` —
   * an actual process kill, browser crash, or `kill -9`) while a debounce
   * window is still open, the mutation(s) inside that window are not
   * durable on this device alone. They may already be durable elsewhere —
   * another device, or the server — via ordinary sync ahead of the crash;
   * this class has no visibility into that and makes no claim about it
   * either way. A clean shutdown never loses this window: dispose() below
   * flushes synchronously before tearing down.
   */
  #scheduleFlush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flushInFlight = this.#persist()
        .catch((error: unknown) => {
          this.#pendingFlushError = error;
        })
        .finally(() => {
          this.#flushInFlight = null;
        });
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * F144. Raised as `PendingFlushDiscardedError` rather than as the captured
   * cause, so "the store is locked" and "the store is locked AND you lost
   * writes" are different answers at the boundary instead of the same string.
   */
  #throwPendingFlushError(): void {
    if (this.#pendingFlushError !== null) {
      const error = this.#pendingFlushError;
      this.#pendingFlushError = null;
      throw new PendingFlushDiscardedError(error);
    }
  }

  /**
   * FDN-50 stage 2 Decision 2 (shallow-anchor a flush against the previous
   * durable frontier, full snapshot only as the bootstrap) is NOT
   * implemented here — every flush still writes a full `{ mode: "snapshot"
   * }`, same as stage 1. Building it surfaced a constraint in
   * loro-crdt@1.14.1 that the scoped design cannot be written around, not a
   * frontier-tracking bug in this file. Verified twice over: once in
   * isolated Node scripts, and once as a fully instrumented implementation
   * running in real Chromium against the real Worker, the real SealedStore,
   * and the real `loro-crdt/web` WASM build this file imports.
   *
   * Two things about the failure matter more than the message itself, and
   * both are easy to get wrong on a first reading:
   *
   * 1. `export({ mode: "shallow-snapshot", frontiers })` SUCCEEDS. It is
   *    `import()` of the bytes it produced that throws "You cannot switch a
   *    document to a version before the shallow history's start version"
   *    (thrown as a bare string, with no `.message` and no `.stack`). A
   *    flush that does not round-trip its own bytes before committing them
   *    therefore writes a snapshot that cannot be read back, and the
   *    workspace only fails on the NEXT `initialize()` — silent durable
   *    corruption, discovered long after the flush that caused it.
   *
   * 2. The trigger is NOT "the document merged ops from a peer that did not
   *    exist when `frontiers` was captured." A brand-new peer whose ops are
   *    causal descendants of the anchor round-trips perfectly, repeatedly,
   *    across reopen cycles. The shape that reproducibly fails is narrower:
   *    a document whose history is two or more CONCURRENT ROOT ops, with
   *    the anchor naming only some of them. That distinction is why this
   *    reproduces here but did not reproduce in earlier scripts, which
   *    happened to build causally ordered histories.
   *
   *    The precise boundary is narrower still than "any anchor that fails
   *    to dominate the document," and is not fully characterized here: a
   *    concurrent op grafted onto a deeper shared history, anchored
   *    mid-chain, did round-trip cleanly. Do not read this comment as a
   *    general rule about Loro; read it as the one shape this Worker
   *    actually produces, which is a forest of concurrent roots, because
   *    every delta it merges arrives as an independently authored document
   *    whose first op is its own root.
   *
   * The previous durable frontier is exactly such an anchor whenever a
   * delta arriving after it is concurrent with it rather than descended
   * from it — which for a CRDT merging independently authored history is
   * ordinary, not exotic. All three frontier sources this file could have
   * used (`oplogFrontiers()`, `frontiers()`, `vvToFrontiers(version())`)
   * return identical values at the failure point, so the accessor choice is
   * not the variable. The only anchor that always round-trips is the
   * document's current frontier at export time, which dominates everything
   * by construction — but that drops all history rather than anchoring at
   * the previous durable version, so it is a different decision than the
   * one scoped, and it degenerates to a full snapshot exactly when
   * concurrent roots are present. Filed as a candidate finding rather than
   * worked around; see this stage's report for the captured state at
   * failure.
   */
  async #persist(): Promise<void> {
    const workspaceId = this.#workspaceId;
    const document = this.#document;
    if (workspaceId === null || document === null) {
      throw new Error("Worker is not initialized");
    }
    // F138. See `#materializationFailed`: this document is known not to
    // materialize, so writing it would replace a good snapshot with one that
    // makes the workspace refuse to open.
    if (this.#materializationFailed) {
      throw new Error(
        "Refusing to persist a document that failed to materialize; the last " +
          "durable snapshot is kept instead",
      );
    }

    // FDN-50 stage 3: every durable write records the generation it was
    // written under, so the gate in initialize() has something to read on
    // the next reopen. Stamped here rather than in initialize() so that the
    // bootstrap case behaves exactly as stage 1 proved it does — a fresh
    // workspace that never mutates writes nothing at all, and its FIRST
    // persist is what records the generation. This is a no-op on every
    // later flush (the value is already present and equal), so it neither
    // grows history nor changes the debounce behavior above it.
    stampDocumentSchemaGeneration(document);

    const snapshot = document.export({ mode: "snapshot" });
    await this.#sealedStore.put(graphSnapshotStoreKey(workspaceId), snapshot);
  }

  /**
   * Flushes any pending debounced write synchronously before the document
   * is freed, so a clean dispose() never loses the in-flight window — only
   * a genuine crash can (see #scheduleFlush's comment). A pending timer is
   * cancelled and its flush run directly; a flush already in flight
   * (the timer already fired, its callback already started #persist) is
   * awaited rather than duplicated. A failure here is captured the same way
   * the debounce timer's own failures are (`#pendingFlushError`), never
   * thrown from inside this method — dispose() must still tear the rest of
   * the runtime down even when this flush failed, and reports the failure
   * itself only once teardown is otherwise complete.
   */
  async #flushBeforeTeardown(): Promise<void> {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
      if (this.#document !== null) {
        try {
          await this.#persist();
        } catch (error: unknown) {
          this.#pendingFlushError = error;
        }
      }
      return;
    }
    if (this.#flushInFlight !== null) {
      await this.#flushInFlight;
    }
  }

  async dispose(): Promise<void> {
    this.#stopRolePolling();
    await this.stopSync();
    this.#apiOrigin = null;
    await this.#flushBeforeTeardown();
    await this.#index?.dispose();
    this.#index = null;
    this.#document?.free();
    this.#document = null;
    this.#protectedPartitions.dispose();
    this.#tier3Partitions.dispose();
    this.#pendingTier3Proposal?.dispose();
    this.#pendingTier3Proposal = null;
    this.#tier1Identity = null;
    this.#pendingTier1TransferTargets.clear();
    this.#protectedVersion = null;
    this.#tier3Version = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
    this.#sealedStore.dispose();
    // Reported last, after every resource above is fully torn down: a
    // background flush failure (this dispose()'s own drain, or one the
    // caller never observed via a prior applyDeltaBatch) must still surface
    // to whoever called dispose(), but must never leave teardown half-done.
    this.#throwPendingFlushError();
  }

  /**
   * Releases the plaintext this Worker holds and returns the runtime to its
   * pre-`initialize()` state, rather than inventing a fourth lifecycle
   * condition for "initialized but holding nothing."
   *
   * Shared by `#endLocalSession` and `eraseLocalStore` so the two can never
   * drift into releasing different things — the failure mode where a wipe
   * clears disk and leaves a queryable plaintext index behind.
   */
  async #purgeInMemoryState(): Promise<void> {
    this.#stopSyncInternal();
    await this.#index?.dispose();
    this.#index = null;
    this.#document?.free();
    this.#document = null;
    this.#protectedPartitions.dispose();
    this.#tier3Partitions.dispose();
    this.#pendingTier3Proposal?.dispose();
    this.#pendingTier3Proposal = null;
    this.#tier1Identity = null;
    this.#pendingTier1TransferTargets.clear();
    this.#protectedVersion = null;
    this.#tier3Version = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
    this.#materializationFailed = false;
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
  }

  #requireIndex(): SQLiteGraphIndex {
    if (this.#index === null) throw new Error("Worker is not initialized");
    return this.#index;
  }

  #requireDocument(): LoroDoc {
    if (this.#document === null) throw new Error("Worker is not initialized");
    return this.#document;
  }

  #requireWorkspaceId(): string {
    if (this.#workspaceId === null) throw new Error("Worker is not initialized");
    return this.#workspaceId;
  }

  #requireAddressWorkspace(address: ProtectedDocumentAddress): string {
    const workspaceId = this.#requireWorkspaceId();
    if (address.workspaceId !== workspaceId) {
      throw new Error(
        "Protected document workspace does not match the current Worker workspace",
      );
    }
    return workspaceId;
  }

  #requireRootWorkspace(address: Tier3RootAddress): string {
    const workspaceId = this.#requireWorkspaceId();
    if (address.workspaceId !== workspaceId) {
      throw new Error("Tier 3 root does not match the current Worker workspace");
    }
    return workspaceId;
  }
}
