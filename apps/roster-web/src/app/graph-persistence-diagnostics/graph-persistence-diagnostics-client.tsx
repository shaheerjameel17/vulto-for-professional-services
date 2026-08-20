"use client";

import {
  graphSnapshotStoreKey,
  type GraphQuery,
  type GraphQueryResult,
  type LocalGraphClient,
} from "@vulto/graph";
import {
  createUncheckedLocalGraphClient,
  type UncheckedLocalGraphClient,
} from "@vulto/graph/testing/unchecked-mutation";
import {
  buildBackdatedMoveSnapshot,
  buildConcurrentMoveSnapshots,
  buildSequentialMoveSnapshot,
  materializeFromSnapshots,
  PROOF_EMPLOYEE,
  PROOF_MANAGER_A,
  PROOF_MANAGER_B,
  resolvedManagerOf,
} from "@vulto/graph/testing";
import { buildProofEmployeeFragmentsSnapshot } from "@vulto/graph/testing/chain";
import {
  buildPermissionProofEmployeeSnapshot,
  buildPermissionProofOrgScenarioSnapshot,
  PERMISSION_PROOF_EMPLOYEE,
} from "@vulto/graph/testing/permission";
import {
  buildBulkEmployeeSnapshot,
  buildCleanEmployeeSnapshot,
  buildConflictingNodeTypePoison,
  buildForeignWorkspacePoison,
  buildMalformedRecordPoison,
  POISON_PROOF_EMPLOYEE,
} from "@vulto/graph/testing/poisoning";
import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";
import { apiOrigin } from "../../lib/auth-client";

interface GraphPersistenceDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  /** Drops the sealed-store key from Worker memory, without disposing the Worker or the workspace binding — used to prove persist/reopen fail cleanly once locked. */
  lock(): Promise<void>;
  /**
   * S1 (FDN-54). Re-unlocks the SAME Worker instance mid-session, without a
   * reload — the identical `LocalGraphClient#unlockSealedStore` call the
   * locked shell's Retry button makes, and no new production surface.
   *
   * `LockedShellGate` only reads the lock state once, on mount, so a store
   * locked mid-session by a revocation never re-renders the gate and its
   * Retry button is unreachable to a test. This exists so an S1 proof can
   * ask the one question that distinguishes "the plaintext was retained"
   * from "the plaintext was discarded": after a revocation locks the store,
   * is the Worker's in-memory document and materialized index still there?
   *
   * Reported rather than thrown, so a denied re-unlock is an observation
   * instead of a stack trace.
   */
  unlock(): Promise<{ unlocked: boolean; error?: string }>;
  /**
   * FDN-87. `VPS-F001` G04's erase, called directly on the same client every
   * other method here uses — `eraseLocalStore` IS the mechanism's real
   * surface, so there is no test seam between this harness and production.
   */
  eraseLocalStore(workspaceId: string): Promise<void>;
  /**
   * Builds a self-contained Loro snapshot (a fresh scratch document, never
   * the runtime's own document) that sets one key on a fixed map name, and
   * returns it base64-encoded. This is FDN-50 stage 1's test-only way to
   * mutate the document: it drives `applyDeltaBatch` with synthetic CRDT
   * bytes, exactly as FDN-77's own browser-tests already do (see
   * packages/graph/browser-tests/main-thread-responsiveness.spec.ts).
   *
   * As of FDN-53 stage 2 (F131), `applyDeltaBatch` is no longer
   * application-callable — it is demoted to Worker-internal/test-only,
   * reached here only via `@vulto/graph/testing/unchecked-mutation`.
   * `mutate` is the real, permission-gated application-callable local
   * WRITE path; this harness deliberately writes bytes `mutate`'s Gate 1
   * cannot resolve (a bare map key with no node type or partition), so it
   * keeps using the unchecked seam rather than migrating to `mutate`.
   */
  buildSnapshot(mapKey: string, value: string): string;
  applyDeltaBatch(
    base64Snapshots: readonly string[],
  ): Promise<{ mergedDeltaCount: number }>;
  openPayload(storeKey: string): Promise<string | null>;
  /** Decodes a base64 Loro snapshot (as returned by openPayload) and reads one map key back out of it, entirely client-side. */
  readSnapshotValue(base64Snapshot: string, mapKey: string): string | null;
  storeKeyFor(workspaceId: string): string;
  /**
   * FDN-50 stage 3. Writes a base64 payload straight into the already
   * unlocked sealed store through the real, already-existing
   * `sealPayload` entrypoint on LocalGraphClient. Adds no new production
   * surface: it is the same method stage 1's runtime already exposes.
   *
   * This is how a test plants a document written by a NEWER client, which
   * is otherwise unconstructable — this build never writes a generation
   * above its own, by design.
   */
  sealPayload(storeKey: string, base64Snapshot: string): Promise<void>;
  /**
   * Builds a scratch Loro snapshot (never the runtime's own document) whose
   * only content is the reserved document-meta container, stamped at
   * `generation`. Same scratch-document technique as `buildSnapshot` above.
   */
  buildGenerationStampedSnapshot(generation: number): string;
  /** Reads the recorded document schema generation back out of a base64 snapshot, client-side. */
  readSnapshotGeneration(base64Snapshot: string): number | null;
  /**
   * Builds a scratch snapshot holding a record-shaped object, so a test can
   * carry a property this build does not recognize through persist/reopen.
   */
  buildRecordSnapshot(mapKey: string, record: Record<string, unknown>): string;
  /** Reads a record-shaped object back out of a base64 snapshot, client-side. */
  readSnapshotRecord(
    base64Snapshot: string,
    mapKey: string,
  ): Record<string, unknown> | null;
  /** Disposes the current client/Worker directly and awaits the round trip, without navigating away — used to prove a debounced flush still lands when dispose() is called inside the debounce window. */
  dispose(): Promise<void>;
  /**
   * F139. Switches this same client to another workspace, which must flush
   * the debounce window of the workspace being left — the property this
   * harness exists to let a browser proof observe.
   */
  switchWorkspace(workspaceId: string): Promise<void>;
  /**
   * FDN-50 stage 4. The `managed_by` materialization proof seam, re-exported
   * from `@vulto/graph/testing` — a subpath that exists precisely so the
   * materializer is NOT reachable from the package's main export. Per F105
   * FDN-53 remains the first application-callable read or write path over
   * graph state, and none of this is one: every function below operates on
   * scratch documents the caller supplies, exactly as `buildSnapshot` above
   * has since stage 1.
   */
  managedBy: {
    /** Two genuinely separate offline LoroDocs moving one employee to different managers. */
    buildConcurrentMoveSnapshots(): {
      seed: string;
      deviceA: string;
      deviceB: string;
    };
    buildSequentialMoveSnapshot(): string;
    buildBackdatedMoveSnapshot(): string;
    /**
     * FDN-50 stage 5: the three proof employees' node records, with no
     * Tree. Since stage 5 wired materialization into the live
     * `applyDeltaBatch`, a Tree-only document is refused there — a
     * materialized edge's endpoints must themselves be materialized — so a
     * proof that drives the real runtime hands it this first.
     */
    buildEmployeeFragments(workspaceId: string): string;
    /** Merges the snapshots in the ORDER GIVEN, then materializes. */
    materializeFromSnapshots(
      base64Snapshots: readonly string[],
    ): Promise<{ summary: string[]; canonical: string }>;
    resolvedManagerOf(base64Snapshots: readonly string[]): string | null;
    employeeId: string;
    managerAId: string;
    managerBId: string;
  };
  /**
   * FDN-50 stage 5. Runs the complete chain — Tree move, materialized
   * `managed_by` edges, SQLite index, queried back, across a real close and
   * reopen — inside a test-only Worker that constructs the real
   * `LocalGraphWorkerRuntime` directly.
   *
   * It deliberately does NOT go through `LocalGraphClient`: reading query
   * results back over the production protocol would be the
   * application-facing read path F105 reserves for FDN-53. Same test-seam
   * technique as the FDN-48 materialization proof Worker the
   * worker-diagnostics route already spawns.
   */
  runChainProof(danglingWorkspaceId: string): Promise<ChainProofResult>;
  /**
   * FDN-50 stage 5. Proves mutate/materialize/query with the network gone.
   * Two steps because the unlock is a deliberate server round-trip (F106):
   * `open()` runs online, `prove()` runs after the test cuts the network.
   */
  createOfflineProof(): OfflineProofHandle;
  /**
   * FDN-53 stage 1: the first production, permission-filtered graph read
   * path. Calls `LocalGraphClient#query` directly — no separate test seam,
   * since `query` is itself the application-callable surface this stage
   * builds (F105).
   */
  query(graphQuery: GraphQuery): Promise<GraphQueryResult>;
  /** F127's live role-refresh entrypoint, called directly on the same client `query` uses. */
  refreshRole(): Promise<string[]>;
  /**
   * FDN-53 stage 2's real, permission-gated write path. Called directly on
   * the same client `query` uses — `mutate` IS the application-callable
   * surface, so there is no test seam between this harness and production.
   *
   * Returns the outcome as a plain object rather than throwing, so an F138
   * proof can distinguish "the gate refused" from "the Worker died" — a
   * distinction the whole finding turns on.
   */
  mutate(
    base64Snapshots: readonly string[],
  ): Promise<
    { status: string; reason?: string; mergedDeltaCount?: number } | { thrown: string }
  >;
  /** F138 poison fixtures, from `@vulto/graph/testing/poisoning`. */
  poisoning: {
    employeeId: string;
    buildBulk(workspaceId: string, count: number): string;
    buildClean(workspaceId: string): string;
    buildForeignWorkspacePoison(): string;
    buildConflictingNodeTypePoison(workspaceId: string): string;
    buildMalformedRecordPoison(workspaceId: string): string;
  };
  /** FDN-53 stage 1's own browser-proof fixture: one Employee, both privacy partitions. */
  permissionProof: {
    employeeId: string;
    buildEmployeeFragments(workspaceId: string): string;
    buildOrgScenario(workspaceId: string, nodeId: string): string;
  };
}

interface OfflineProofHandle {
  open(): Promise<{ opened: boolean }>;
  prove(): Promise<OfflineProofResult>;
  dispose(): void;
}

interface OfflineProofResult {
  employeesAfterOfflineMutation: number;
  managerAfterOfflineMutation: string | null;
  managerBeforeFirstEffectiveDate: string | null;
  generationBefore: number;
  generationAfter: number;
  canonical: string;
}

interface ChainProofResult {
  employeesBeforeMutation: number;
  employeesAfterMutation: number;
  generationAfterFirstBatch: number;
  generationAfterSecondBatch: number;
  generationAfterReapply: number;
  managerAfterFirstBatch: string | null;
  managerBeforeFirstEffectiveDate: string | null;
  managerAfterReassignment: string | null;
  managerDuringFirstInterval: string | null;
  canonicalBeforeReopen: string;
  canonicalAfterReapply: string;
  canonicalAfterReopen: string;
  employeesAfterReopen: number;
  managerAfterReopen: string | null;
  managerDuringFirstIntervalAfterReopen: string | null;
  danglingEndpointRefusal: string;
  durationMs: number;
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: GraphPersistenceDiagnosticsApi;
  }
}

const MAP_NAME = "fdn50-stage1-proof";

/**
 * FDN-50 stage 3: the reserved document-meta container and key, written out
 * as literals rather than imported from `@vulto/graph`.
 *
 * Deliberate. These two strings are durable on-disk contract — the gate's
 * own comment states they are frozen. Importing the constants would make
 * this harness agree with a rename by construction, which is exactly the
 * change that must NOT pass silently: renaming either one makes every
 * already-persisted document read as "no generation recorded". Spelling
 * them independently here means the browser proof is written against the
 * on-disk contract itself, not against whatever the implementation
 * currently calls it.
 */
const DOCUMENT_META_CONTAINER = "__vulto_document_meta";
const DOCUMENT_SCHEMA_GENERATION_KEY = "schema_generation";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function buildSnapshot(mapKey: string, value: string): string {
  const scratch = new LoroDoc();
  scratch.getMap(MAP_NAME).set(mapKey, value);
  scratch.commit();
  const bytes = scratch.export({ mode: "snapshot" });
  scratch.free();
  return toBase64(bytes);
}

function readSnapshotValue(base64Snapshot: string, mapKey: string): string | null {
  const scratch = new LoroDoc();
  scratch.import(fromBase64(base64Snapshot));
  const value = scratch.getMap(MAP_NAME).get(mapKey);
  scratch.free();
  return typeof value === "string" ? value : null;
}

function buildGenerationStampedSnapshot(generation: number): string {
  const scratch = new LoroDoc();
  scratch
    .getMap(DOCUMENT_META_CONTAINER)
    .set(DOCUMENT_SCHEMA_GENERATION_KEY, generation);
  scratch.commit();
  const bytes = scratch.export({ mode: "snapshot" });
  scratch.free();
  return toBase64(bytes);
}

function readSnapshotGeneration(base64Snapshot: string): number | null {
  const scratch = new LoroDoc();
  scratch.import(fromBase64(base64Snapshot));
  const value = scratch
    .getMap(DOCUMENT_META_CONTAINER)
    .get(DOCUMENT_SCHEMA_GENERATION_KEY);
  scratch.free();
  return typeof value === "number" ? value : null;
}

function buildRecordSnapshot(mapKey: string, record: Record<string, unknown>): string {
  const scratch = new LoroDoc();
  scratch.getMap(MAP_NAME).set(mapKey, record);
  scratch.commit();
  const bytes = scratch.export({ mode: "snapshot" });
  scratch.free();
  return toBase64(bytes);
}

function readSnapshotRecord(
  base64Snapshot: string,
  mapKey: string,
): Record<string, unknown> | null {
  const scratch = new LoroDoc();
  scratch.import(fromBase64(base64Snapshot));
  const value = scratch.getMap(MAP_NAME).get(mapKey);
  scratch.free();
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * FDN-50 stage 5: spawns the chain-proof Worker and waits for its single
 * result message.
 *
 * The Worker is reachable only from this opt-in Playwright diagnostics
 * route, exactly like the FDN-48 materialization proof Worker. It is a test
 * seam, not a production graph message and not a public package API.
 */
function runChainProof(
  workspaceId: string,
  danglingWorkspaceId: string,
): Promise<ChainProofResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL(
        "../../../../../packages/graph/src/worker/testing/runtime-chain-proof.worker.ts",
        import.meta.url,
      ),
      { type: "module", name: "vulto-fdn50-chain-proof" },
    );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate();
      const response = event.data as
        { ok: true; result: ChainProofResult } | { ok: false; error: string };
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Chain proof Worker failed"));
    };
    worker.postMessage({ workspaceId, danglingWorkspaceId, apiOrigin });
  });
}

/**
 * FDN-50 stage 5: the offline half of the same criterion, which needs a
 * long-lived Worker rather than a one-shot one.
 *
 * The unlock cannot happen offline — F106 makes it a server round-trip by
 * design — so this returns a handle whose `open()` runs while the browser
 * is still online and whose `prove()` runs after the test has cut the
 * network. Everything `prove()` does is local: Loro merge,
 * materialization, SQLite query.
 */
function createOfflineProofHandle(workspaceId: string): OfflineProofHandle {
  const worker = new Worker(
    new URL(
      "../../../../../packages/graph/src/worker/testing/runtime-offline-proof.worker.ts",
      import.meta.url,
    ),
    { type: "module", name: "vulto-fdn50-offline-proof" },
  );

  function send<T>(message: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data as
          { ok: true; result: T } | { ok: false; error: string };
        if (response.ok) resolve(response.result);
        else reject(new Error(response.error));
      };
      worker.onerror = (event) =>
        reject(new Error(event.message || "Offline proof Worker failed"));
      worker.postMessage(message);
    });
  }

  return {
    open: () => send<{ opened: boolean }>({ kind: "open", workspaceId, apiOrigin }),
    prove: () => send<OfflineProofResult>({ kind: "prove" }),
    dispose: () => worker.terminate(),
  };
}

export function GraphPersistenceDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-50-browser-proof";
  const clientRef = useRef<UncheckedLocalGraphClient | null>(null);
  const [client, setClient] = useState<LocalGraphClient | null>(null);

  useEffect(() => {
    // FDN-53 stage 2 (F131): this harness needs the demoted, unchecked
    // applyDeltaBatch below, on the SAME Worker instance the rest of this
    // API (initialize, getSealedStoreStatus, dispose) already runs
    // against. See @vulto/graph/testing/unchecked-mutation's doc comment.
    const created = createUncheckedLocalGraphClient(workspaceId);
    clientRef.current = created;
    setClient(created);
    let cancelled = false;

    void initializeLoro().then(() => {
      // The main-thread scratch documents this diagnostics page builds are
      // wholly separate from the Worker's own LoroDoc/WASM instance — this
      // only needs to be ready before buildSnapshot/readSnapshotValue run.
      if (cancelled) return;
      window.__vultoGraphPersistenceDiagnostics = {
        getStatus: () => created.getSealedStoreStatus(),
        initialize: async () => {
          await created.initialize();
        },
        lock: () => created.lockSealedStore(),
        eraseLocalStore: (targetWorkspaceId) =>
          created.eraseLocalStore(targetWorkspaceId),
        unlock: async () => {
          try {
            await created.unlockSealedStore(apiOrigin);
            return { unlocked: true };
          } catch (error: unknown) {
            return {
              unlocked: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        buildSnapshot,
        applyDeltaBatch: async (base64Snapshots) => {
          const result = await created.applyDeltaBatch(base64Snapshots.map(fromBase64));
          return { mergedDeltaCount: result.mergedDeltaCount };
        },
        openPayload: async (storeKey) => {
          const bytes = await created.openPayload(storeKey);
          return bytes ? toBase64(bytes) : null;
        },
        readSnapshotValue,
        storeKeyFor: graphSnapshotStoreKey,
        sealPayload: (storeKey, base64Snapshot) =>
          created.sealPayload(storeKey, fromBase64(base64Snapshot)),
        buildGenerationStampedSnapshot,
        readSnapshotGeneration,
        buildRecordSnapshot,
        readSnapshotRecord,
        dispose: () => created.dispose(),
        switchWorkspace: async (nextWorkspaceId) => {
          await created.switchWorkspace(nextWorkspaceId);
        },
        managedBy: {
          buildConcurrentMoveSnapshots,
          buildSequentialMoveSnapshot,
          buildBackdatedMoveSnapshot,
          buildEmployeeFragments: buildProofEmployeeFragmentsSnapshot,
          materializeFromSnapshots,
          resolvedManagerOf,
          employeeId: PROOF_EMPLOYEE,
          managerAId: PROOF_MANAGER_A,
          managerBId: PROOF_MANAGER_B,
        },
        runChainProof: (danglingWorkspaceId) =>
          runChainProof(workspaceId, danglingWorkspaceId),
        createOfflineProof: () => createOfflineProofHandle(workspaceId),
        query: (graphQuery) => created.query(graphQuery),
        refreshRole: () => created.refreshRole(),
        mutate: async (base64Snapshots) => {
          try {
            return await created.mutate(base64Snapshots.map(fromBase64));
          } catch (error: unknown) {
            // Deliberately reported rather than rethrown: F138 turns on
            // telling a clean refusal apart from a Worker-killing throw.
            return { thrown: error instanceof Error ? error.message : String(error) };
          }
        },
        poisoning: {
          employeeId: POISON_PROOF_EMPLOYEE,
          buildBulk: buildBulkEmployeeSnapshot,
          buildClean: buildCleanEmployeeSnapshot,
          buildForeignWorkspacePoison,
          buildConflictingNodeTypePoison,
          buildMalformedRecordPoison,
        },
        permissionProof: {
          employeeId: PERMISSION_PROOF_EMPLOYEE,
          buildEmployeeFragments: buildPermissionProofEmployeeSnapshot,
          buildOrgScenario: buildPermissionProofOrgScenarioSnapshot,
        },
      };
    });

    return () => {
      cancelled = true;
      delete window.__vultoGraphPersistenceDiagnostics;
      void created.dispose();
    };
  }, [workspaceId]);

  if (!client) return null;

  return (
    <LockedShellGate workspaceId={workspaceId} client={client}>
      <p data-testid="graph-persistence-unlocked">unlocked</p>
    </LockedShellGate>
  );
}
