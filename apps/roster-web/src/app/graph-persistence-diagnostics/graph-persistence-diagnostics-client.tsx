"use client";

import {
  createLocalGraphClient,
  graphSnapshotStoreKey,
  type LocalGraphClient,
} from "@vulto/graph";
import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";

interface GraphPersistenceDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  /** Drops the sealed-store key from Worker memory, without disposing the Worker or the workspace binding — used to prove persist/reopen fail cleanly once locked. */
  lock(): Promise<void>;
  /**
   * Builds a self-contained Loro snapshot (a fresh scratch document, never
   * the runtime's own document) that sets one key on a fixed map name, and
   * returns it base64-encoded. This is FDN-50 stage 1's test-only way to
   * mutate the document: it drives the real, already-existing, already
   * application-callable applyDeltaBatch entrypoint with synthetic CRDT
   * bytes, exactly as FDN-77's own browser-tests already do (see
   * packages/graph/browser-tests/main-thread-responsiveness.spec.ts). It
   * does not add any new local-mutation surface — FDN-53 remains the first
   * application-callable local-mutation path, per F105.
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

export function GraphPersistenceDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-50-browser-proof";
  const clientRef = useRef<LocalGraphClient | null>(null);
  const [client, setClient] = useState<LocalGraphClient | null>(null);

  useEffect(() => {
    const created = createLocalGraphClient(workspaceId);
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
