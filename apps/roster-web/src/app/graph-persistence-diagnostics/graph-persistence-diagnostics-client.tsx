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
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: GraphPersistenceDiagnosticsApi;
  }
}

const MAP_NAME = "fdn50-stage1-proof";

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
