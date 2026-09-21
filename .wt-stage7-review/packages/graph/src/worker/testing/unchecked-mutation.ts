/**
 * FDN-53 stage 2 (F131). The one place `applyDeltaBatch` is reachable from
 * outside `packages/graph` after stage 2 demotes it off `LocalGraphClient`.
 *
 * Exists for the pre-FDN-53 browser proofs — FDN-50's persistence, debounce
 * and main-thread-responsiveness harnesses — that need to commit synthetic,
 * non-schema-conformant CRDT bytes (an arbitrary map key, a generation
 * stamp) directly into a live client Worker's document, unchecked, on the
 * SAME instance their other assertions (`initialize`, `getSealedStoreStatus`,
 * `dispose`) already run against. `mutate`, the gated entrypoint, cannot
 * serve that need: its Gate 1 check requires every changed node fragment to
 * resolve to a registered node type and partition, and these harnesses
 * deliberately write bytes that are neither.
 *
 * The unchecked graph mutation still uses the same production
 * `worker/entry.ts`, protocol, and document as `createLocalGraphClient`.
 * Raw sealed-store access is deliberately different: F175 moved it to a
 * separate diagnostics-only Worker, so the production protocol cannot name
 * or dispatch an arbitrary logical store key. No application code should
 * import this subpath; it is not re-exported from `@vulto/graph`'s main entry.
 */
import type { WorkspaceRole } from "@vulto/schema";
import {
  createUncheckedLocalGraphClient as createGraphClient,
  type DeltaBatchResult,
  type LocalGraphClient,
  type MutationOutcome,
  type UncheckedLocalGraphClient as GraphUncheckedClient,
} from "../../client";
import type { GraphAvailability } from "../../protocol";
import type { GraphQuery } from "../../query";
import type { GraphQueryResult } from "../storage/sqlite-graph-index";
import { TestingSealedStoreClient } from "./sealed-store-client";

export type { DeltaBatchResult } from "../../client";

export interface UncheckedLocalGraphClient extends LocalGraphClient {
  applyDeltaBatch(deltas: readonly Uint8Array[]): Promise<DeltaBatchResult>;
  sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void>;
  openPayload(storeKey: string): Promise<Uint8Array | null>;
}

class TestingLocalGraphClient implements UncheckedLocalGraphClient {
  readonly #graph: GraphUncheckedClient;
  #sealed = new TestingSealedStoreClient();

  constructor(workspaceId: string) {
    this.#graph = createGraphClient(workspaceId);
  }

  get workspaceId(): string {
    return this.#graph.workspaceId;
  }

  initialize(): Promise<GraphAvailability> {
    return this.#graph.initialize();
  }

  applyDeltaBatch(deltas: readonly Uint8Array[]): Promise<DeltaBatchResult> {
    return this.#graph.applyDeltaBatch(deltas);
  }

  mutate(deltas: readonly Uint8Array[]): Promise<MutationOutcome> {
    return this.#graph.mutate(deltas);
  }

  getAvailability(): Promise<GraphAvailability> {
    return this.#graph.getAvailability();
  }

  async switchWorkspace(workspaceId: string): Promise<GraphAvailability> {
    await this.#sealed.dispose();
    this.#sealed = new TestingSealedStoreClient();
    return this.#graph.switchWorkspace(workspaceId);
  }

  async unlockSealedStore(apiOrigin: string): Promise<void> {
    await this.#graph.unlockSealedStore(apiOrigin);
    await this.#sealed.unlock(this.workspaceId, apiOrigin);
  }

  eraseLocalStore(workspaceId: string): Promise<void> {
    return this.#graph.eraseLocalStore(workspaceId);
  }

  async lockSealedStore(): Promise<void> {
    await this.#graph.lockSealedStore();
    await this.#sealed.lock();
  }

  getSealedStoreStatus(): Promise<{ locked: boolean }> {
    return this.#graph.getSealedStoreStatus();
  }

  sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void> {
    return this.#sealed.seal(storeKey, plaintext);
  }

  openPayload(storeKey: string): Promise<Uint8Array | null> {
    return this.#sealed.open(storeKey);
  }

  query(query: GraphQuery): Promise<GraphQueryResult> {
    return this.#graph.query(query);
  }

  refreshRole(): Promise<WorkspaceRole[]> {
    return this.#graph.refreshRole();
  }

  startSync(relayUrl: string): Promise<void> {
    return this.#graph.startSync(relayUrl);
  }

  stopSync(): Promise<void> {
    return this.#graph.stopSync();
  }

  getSyncStatus() {
    return this.#graph.getSyncStatus();
  }

  onSyncStatusChange(
    listener: Parameters<GraphUncheckedClient["onSyncStatusChange"]>[0],
  ): () => void {
    return this.#graph.onSyncStatusChange(listener);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([this.#graph.dispose(), this.#sealed.dispose()]).then(
      (results) => {
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) throw rejected.reason;
      },
    );
  }
}

export function createUncheckedLocalGraphClient(
  workspaceId: string,
): UncheckedLocalGraphClient {
  return new TestingLocalGraphClient(workspaceId);
}
