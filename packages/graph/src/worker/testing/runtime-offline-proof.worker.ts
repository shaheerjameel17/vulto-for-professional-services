import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { parseGraphQuery } from "../../query";
import { LocalGraphWorkerRuntime } from "../runtime";
import type { SQLiteGraphIndex } from "../storage/sqlite-graph-index";
import {
  buildEmployeeGraphSnapshot,
  CHAIN_EMPLOYEE,
  chainProofFromBase64,
} from "./chain-proof";

/**
 * FDN-50 stage 5: mutate, materialize and QUERY with no network at all.
 *
 * FDN-50's done criterion says a workspace can be "created, mutated,
 * closed, reopened, materialized, and queried offline". The chain proof
 * next door proves every verb in that list, but it runs online throughout,
 * so the word "offline" was the one claim in this issue with no test
 * attached to it — and "there is no network call on that path" is
 * reasoning about what the code should do, not evidence of what it does.
 *
 * WHY THIS IS A SEPARATE WORKER WITH A TWO-STEP PROTOCOL
 *
 * The unlock is the one step that genuinely cannot happen offline: F106
 * makes every cold restart a revocation checkpoint, so the sealed store
 * only opens after the server validates the session. A single-message
 * proof would therefore have to unlock while offline and fail for a reason
 * that has nothing to do with what is being tested.
 *
 * So `open` unlocks and initializes while the browser is still online, and
 * `prove` runs afterwards — with the test having cut the network in
 * between. Everything `prove` does is Loro merge, materialization and
 * SQLite query inside this Worker, and it either works with the network
 * gone or it does not.
 *
 * This is also why the criterion's literal wording cannot be satisfied as
 * one unbroken offline path: "reopened ... offline" contradicts F106, which
 * postdates the criterion. Recorded as F126.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

type OfflineProofRequest =
  | { readonly kind: "open"; readonly workspaceId: string; readonly apiOrigin: string }
  | { readonly kind: "prove" };

interface OfflineProofResult {
  readonly employeesAfterOfflineMutation: number;
  readonly managerAfterOfflineMutation: string | null;
  readonly managerBeforeFirstEffectiveDate: string | null;
  readonly generationBefore: number;
  readonly generationAfter: number;
  readonly canonical: string;
}

const AFTER_FIRST_MOVE = "2026-03-01T00:00:00.000Z";
const BEFORE_FIRST_MOVE = "2025-06-01T00:00:00.000Z";

let runtime: LocalGraphWorkerRuntime | null = null;
let openedWorkspaceId: string | null = null;

function requireIndex(instance: LocalGraphWorkerRuntime): SQLiteGraphIndex {
  const index = instance.materializedIndexForDiagnostics;
  if (index === null) throw new Error("The runtime has no materialized index");
  return index;
}

async function managerAsOf(
  index: SQLiteGraphIndex,
  asOf: string,
): Promise<string | null> {
  const result = await index.execute(
    parseGraphQuery({
      kind: "edge-neighbors",
      startNodeId: CHAIN_EMPLOYEE,
      direction: "outgoing",
      asOf,
      edgeType: "managed_by",
      fromNodeType: "Employee",
      toNodeType: "Employee",
      limit: 10,
    }),
  );
  if (result.kind !== "edge-neighbors") throw new Error("Unexpected query result");
  return result.neighbors[0]?.node.nodeId ?? null;
}

async function employeeCount(index: SQLiteGraphIndex): Promise<number> {
  const result = await index.execute(
    parseGraphQuery({ kind: "node-list", nodeType: "Employee", limit: 200 }),
  );
  if (result.kind !== "node-list") throw new Error("Unexpected query result");
  return result.nodes.length;
}

async function open(workspaceId: string, apiOrigin: string): Promise<void> {
  await initializeLoro();
  const instance = new LocalGraphWorkerRuntime();
  await instance.unlockSealedStore(workspaceId, apiOrigin);
  await instance.initialize(workspaceId);
  runtime = instance;
  openedWorkspaceId = workspaceId;
}

async function prove(): Promise<OfflineProofResult> {
  if (runtime === null || openedWorkspaceId === null) {
    throw new Error("prove was called before open");
  }
  const index = requireIndex(runtime);
  const generationBefore = await index.generation;

  // One batch carrying the three employees' node records AND the Tree move
  // that makes the first one report to manager A, with the move's own
  // effective date on it per F124. No network is reachable at this point.
  await runtime.applyDeltaBatch([
    chainProofFromBase64(buildEmployeeGraphSnapshot(openedWorkspaceId)).slice().buffer,
  ]);

  return {
    employeesAfterOfflineMutation: await employeeCount(index),
    managerAfterOfflineMutation: await managerAsOf(index, AFTER_FIRST_MOVE),
    managerBeforeFirstEffectiveDate: await managerAsOf(index, BEFORE_FIRST_MOVE),
    generationBefore,
    generationAfter: await index.generation,
    canonical: index.canonicalSnapshot(),
  };
}

scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data as OfflineProofRequest;
  const work =
    request.kind === "open"
      ? open(request.workspaceId, request.apiOrigin).then(() => ({ opened: true }))
      : prove();
  void work
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown offline proof failure",
      }),
    );
};
