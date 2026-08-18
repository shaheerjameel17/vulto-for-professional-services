import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { parseGraphQuery } from "../../query";
import { LocalGraphWorkerRuntime } from "../runtime";
import type { SQLiteGraphIndex } from "../storage/sqlite-graph-index";
import {
  buildDanglingEndpointSnapshot,
  buildEmployeeGraphSnapshot,
  buildReassignmentSnapshot,
  CHAIN_EMPLOYEE,
  chainProofFromBase64,
} from "./chain-proof";

/**
 * FDN-50 stage 5: the complete chain, proven end to end in one Worker.
 *
 *   a Tree move  ->  materialized `managed_by` edges  ->  the SQLite index
 *                ->  queried back
 *
 * and then again across a genuine close and reopen, so that "a workspace
 * can be created, mutated, closed, reopened, materialized, and queried
 * offline" is one continuous path rather than several that share a
 * document.
 *
 * Everything here is real: the real `LocalGraphWorkerRuntime`, the real
 * FDN-84 `SealedStore` behind a real online unlock, real `loro-crdt/web`
 * WASM, and real SQLite-WASM. Nothing is stubbed and nothing is simulated.
 *
 * Why a second, test-only Worker rather than a message on the production
 * protocol: reading query results back through `packages/graph`'s protocol
 * would BE an application-facing read path, which F105 reserves for FDN-53
 * behind `VPS-A004`'s permission interceptor. This Worker instead
 * constructs the runtime directly — the same test-seam technique
 * `browser-proof.worker.ts` has used since FDN-48 — so the production
 * surface gains nothing at all.
 */

interface ProofScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
}

interface ChainProofRequest {
  readonly workspaceId: string;
  readonly danglingWorkspaceId: string;
  readonly apiOrigin: string;
}

interface ChainProofResult {
  readonly employeesBeforeMutation: number;
  readonly employeesAfterMutation: number;
  readonly generationAfterFirstBatch: number;
  readonly generationAfterSecondBatch: number;
  readonly generationAfterReapply: number;
  readonly managerAfterFirstBatch: string | null;
  readonly managerBeforeFirstEffectiveDate: string | null;
  readonly managerAfterReassignment: string | null;
  readonly managerDuringFirstInterval: string | null;
  readonly canonicalBeforeReopen: string;
  readonly canonicalAfterReapply: string;
  readonly canonicalAfterReopen: string;
  readonly employeesAfterReopen: number;
  readonly managerAfterReopen: string | null;
  readonly managerDuringFirstIntervalAfterReopen: string | null;
  readonly danglingEndpointRefusal: string;
  readonly durationMs: number;
}

const scope = self as unknown as ProofScope;

/** An instant inside the first reporting line, before the reassignment. */
const DURING_FIRST_INTERVAL = "2026-03-01T00:00:00.000Z";
/** An instant after the reassignment took effect. */
const AFTER_REASSIGNMENT = "2026-08-01T00:00:00.000Z";
/** An instant before any reporting line existed at all. */
const BEFORE_ANY_LINE = "2025-06-01T00:00:00.000Z";

function requireIndex(runtime: LocalGraphWorkerRuntime): SQLiteGraphIndex {
  const index = runtime.materializedIndexForDiagnostics;
  if (index === null) throw new Error("The runtime has no materialized index");
  return index;
}

/**
 * Reads the employee's manager out of SQLITE — not out of the Loro
 * document, and not out of the materializer's return value. This is the
 * step that makes the proof a chain rather than a pair of assertions: the
 * answer comes back through the real typed query, the real
 * `graph_edges_outgoing` index, and the real endpoint-visibility join.
 */
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

async function runProof(request: ChainProofRequest): Promise<ChainProofResult> {
  const startedAt = performance.now();
  await initializeLoro();

  const first = new LocalGraphWorkerRuntime();
  let canonicalBeforeReopen = "";
  let canonicalAfterReapply = "";
  let employeesBeforeMutation = -1;
  let employeesAfterMutation = -1;
  let generationAfterFirstBatch = -1;
  let generationAfterSecondBatch = -1;
  let generationAfterReapply = -1;
  let managerAfterFirstBatch: string | null = null;
  let managerBeforeFirstEffectiveDate: string | null = null;
  let managerAfterReassignment: string | null = null;
  let managerDuringFirstInterval: string | null = null;

  try {
    await first.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await first.initialize(request.workspaceId);

    // A brand-new workspace materializes to an empty index — nothing is
    // invented for it, and the query surface exists before any mutation.
    employeesBeforeMutation = await employeeCount(requireIndex(first));

    // 1. MUTATE through the real production entrypoint. The bytes carry
    //    node fragments and a dated Tree move; no edge is ever written.
    const opening = buildEmployeeGraphSnapshot(request.workspaceId);
    const openingBatch = await first.applyDeltaBatch([
      chainProofFromBase64(opening).slice().buffer,
    ]);
    generationAfterFirstBatch = openingBatch.materializationGeneration;

    // 2. QUERY IT BACK out of SQLite. The Tree move has become an edge.
    employeesAfterMutation = await employeeCount(requireIndex(first));
    managerAfterFirstBatch = await managerAsOf(
      requireIndex(first),
      DURING_FIRST_INTERVAL,
    );
    // Before the move's own effective date there is no reporting line: the
    // interval is half-open `[from, to)` and the date came from the move,
    // not from a clock read here.
    managerBeforeFirstEffectiveDate = await managerAsOf(
      requireIndex(first),
      BEFORE_ANY_LINE,
    );

    // 3. A second, forward-effective move. History is preserved: the old
    //    line still answers for its own interval.
    const reassignment = buildReassignmentSnapshot(opening);
    const reassignmentBatch = await first.applyDeltaBatch([
      chainProofFromBase64(reassignment).slice().buffer,
    ]);
    generationAfterSecondBatch = reassignmentBatch.materializationGeneration;
    managerAfterReassignment = await managerAsOf(
      requireIndex(first),
      AFTER_REASSIGNMENT,
    );
    managerDuringFirstInterval = await managerAsOf(
      requireIndex(first),
      DURING_FIRST_INTERVAL,
    );
    canonicalBeforeReopen = requireIndex(first).canonicalSnapshot();

    // 4. IDEMPOTENCY: re-applying bytes the document has already seen
    //    re-materializes everything from scratch and lands on an identical
    //    index. The generation advances, proving the work really ran again
    //    rather than being skipped.
    const reapplied = await first.applyDeltaBatch([
      chainProofFromBase64(opening).slice().buffer,
    ]);
    generationAfterReapply = reapplied.materializationGeneration;
    canonicalAfterReapply = requireIndex(first).canonicalSnapshot();
  } finally {
    // 5. CLOSE. dispose() flushes the debounced write synchronously before
    //    tearing the document down, so nothing in the window is lost.
    await first.dispose();
  }

  // 6. REOPEN on a genuinely separate runtime instance, with its own
  //    SealedStore that starts locked and must unlock online again. Its
  //    SQLite index starts empty; everything it answers with has to come
  //    from re-materializing the reopened document.
  const second = new LocalGraphWorkerRuntime();
  let canonicalAfterReopen = "";
  let employeesAfterReopen = -1;
  let managerAfterReopen: string | null = null;
  let managerDuringFirstIntervalAfterReopen: string | null = null;
  try {
    await second.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await second.initialize(request.workspaceId);
    employeesAfterReopen = await employeeCount(requireIndex(second));
    managerAfterReopen = await managerAsOf(requireIndex(second), AFTER_REASSIGNMENT);
    managerDuringFirstIntervalAfterReopen = await managerAsOf(
      requireIndex(second),
      DURING_FIRST_INTERVAL,
    );
    canonicalAfterReopen = requireIndex(second).canonicalSnapshot();
  } finally {
    await second.dispose();
  }

  // 7. A Tree naming an employee with no node record must be refused, not
  //    materialized as an edge into nowhere. Run on its own workspace, so
  //    it meets a document that genuinely lacks the fragment.
  const third = new LocalGraphWorkerRuntime();
  let danglingEndpointRefusal = "not attempted";
  try {
    await third.unlockSealedStore(request.danglingWorkspaceId, request.apiOrigin);
    await third.initialize(request.danglingWorkspaceId);
    const dangling = buildDanglingEndpointSnapshot(request.danglingWorkspaceId);
    try {
      await third.applyDeltaBatch([chainProofFromBase64(dangling).slice().buffer]);
      danglingEndpointRefusal = "succeeded";
    } catch (error: unknown) {
      danglingEndpointRefusal = error instanceof Error ? error.message : String(error);
    }
  } finally {
    await third.dispose().catch(() => undefined);
  }

  return {
    employeesBeforeMutation,
    employeesAfterMutation,
    generationAfterFirstBatch,
    generationAfterSecondBatch,
    generationAfterReapply,
    managerAfterFirstBatch,
    managerBeforeFirstEffectiveDate,
    managerAfterReassignment,
    managerDuringFirstInterval,
    canonicalBeforeReopen,
    canonicalAfterReapply,
    canonicalAfterReopen,
    employeesAfterReopen,
    managerAfterReopen,
    managerDuringFirstIntervalAfterReopen,
    danglingEndpointRefusal,
    durationMs: performance.now() - startedAt,
  };
}

scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data as ChainProofRequest;
  void runProof(request)
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown chain proof failure",
      }),
    );
};
