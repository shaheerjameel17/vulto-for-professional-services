"use client";

import {
  graphSnapshotStoreKey,
  type LocalGraphClient,
  type SyncStatusSnapshot,
} from "@vulto/graph";
import {
  createUncheckedLocalGraphClient,
  type UncheckedLocalGraphClient,
} from "@vulto/graph/testing/unchecked-mutation";
import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";
import { apiOrigin, syncRelayUrl } from "../../lib/auth-client";

const MAP_NAME = "fdn51-stage4a-proof";

interface GraphSyncDiagnosticsApi {
  initialize(): Promise<void>;
  unlock(): Promise<{ unlocked: boolean; error?: string }>;
  eraseLocalStore(workspaceId: string): Promise<void>;
  dispose(): Promise<void>;

  startSync(): Promise<void>;
  stopSync(): Promise<void>;
  getSyncStatus(): SyncStatusSnapshot;
  /** Every SyncStatus this client has emitted since load, oldest first. */
  syncStatusHistory(): SyncStatusSnapshot[];
  /** Resolves once `getSyncStatus().state` equals `state`, or rejects on timeout. */
  waitForSyncState(
    state: SyncStatusSnapshot["state"],
    timeoutMs: number,
  ): Promise<void>;
  waitForNoPendingLocalChanges(timeoutMs: number): Promise<void>;

  /** A real Loro *update* export (not a snapshot) setting one map key. Base64. */
  buildUpdateDelta(mapKey: string, value: string): string;
  applyDeltaBatch(
    base64Deltas: readonly string[],
  ): Promise<{ mergedDeltaCount: number }>;
  /** Reads one map key out of the workspace's flushed sealed snapshot, client-side. */
  readPersistedValue(workspaceId: string, mapKey: string): Promise<string | null>;
}

declare global {
  interface Window {
    __vultoGraphSyncDiagnostics?: GraphSyncDiagnosticsApi;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildUpdateDelta(mapKey: string, value: string): string {
  const scratch = new LoroDoc();
  scratch.getMap(MAP_NAME).set(mapKey, value);
  scratch.commit();
  const bytes = scratch.export({ mode: "update" });
  scratch.free();
  return toBase64(bytes);
}

function readMapKey(base64Snapshot: string, mapKey: string): string | null {
  const scratch = new LoroDoc();
  scratch.import(fromBase64(base64Snapshot));
  const value = scratch.getMap(MAP_NAME).get(mapKey);
  scratch.free();
  return typeof value === "string" ? value : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function GraphSyncDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-51-stage4a-proof";
  const clientRef = useRef<UncheckedLocalGraphClient | null>(null);
  const [client, setClient] = useState<LocalGraphClient | null>(null);

  useEffect(() => {
    const created = createUncheckedLocalGraphClient(workspaceId);
    clientRef.current = created;
    setClient(created);
    let cancelled = false;

    const history: SyncStatusSnapshot[] = [];
    const unsubscribe = created.onSyncStatusChange((snapshot) => {
      history.push(snapshot);
    });

    void initializeLoro().then(() => {
      if (cancelled) return;
      window.__vultoGraphSyncDiagnostics = {
        initialize: async () => {
          await created.initialize();
        },
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
        eraseLocalStore: (id) => created.eraseLocalStore(id),
        dispose: () => created.dispose(),

        startSync: () => created.startSync(syncRelayUrl),
        stopSync: () => created.stopSync(),
        getSyncStatus: () => created.getSyncStatus(),
        syncStatusHistory: () => [...history],
        waitForSyncState: async (state, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (created.getSyncStatus().state !== state) {
            if (Date.now() > deadline) {
              throw new Error(
                `sync did not reach ${state} in ${timeoutMs}ms; last: ${JSON.stringify(
                  created.getSyncStatus(),
                )}`,
              );
            }
            await sleep(50);
          }
        },
        waitForNoPendingLocalChanges: async (timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (created.getSyncStatus().pendingLocalChanges) {
            if (Date.now() > deadline) {
              throw new Error(
                `local changes still pending after ${timeoutMs}ms: ${JSON.stringify(
                  created.getSyncStatus(),
                )}`,
              );
            }
            await sleep(50);
          }
        },

        buildUpdateDelta,
        applyDeltaBatch: async (base64Deltas) => {
          const result = await created.applyDeltaBatch(base64Deltas.map(fromBase64));
          return { mergedDeltaCount: result.mergedDeltaCount };
        },
        readPersistedValue: async (id, mapKey) => {
          const bytes = await created.openPayload(graphSnapshotStoreKey(id));
          return bytes ? readMapKey(toBase64(bytes), mapKey) : null;
        },
      };
    });

    return () => {
      cancelled = true;
      unsubscribe();
      delete window.__vultoGraphSyncDiagnostics;
      void created.dispose();
    };
  }, [workspaceId]);

  if (!client) return null;

  return (
    <LockedShellGate workspaceId={workspaceId} client={client}>
      <main
        data-testid="graph-sync-unlocked"
        style={{ padding: 24, fontFamily: "system-ui" }}
      >
        <h1>FDN-51 Stage 4a — sync diagnostics</h1>
        <p>
          Driven by Playwright through <code>window.__vultoGraphSyncDiagnostics</code>.
        </p>
      </main>
    </LockedShellGate>
  );
}
