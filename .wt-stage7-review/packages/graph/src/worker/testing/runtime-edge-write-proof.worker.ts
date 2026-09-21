import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { parseGraphQuery } from "../../query";
import { LocalGraphWorkerRuntime } from "../runtime";
import type { SQLiteGraphIndex } from "../storage/sqlite-graph-index";
import {
  buildFinanceEndpointFragmentsSnapshot,
  buildGovernedByEdgeSnapshot,
  buildHasSkillEdgeSnapshot,
  buildHasSkillFieldPatchSnapshot,
  buildHoldsCertificationEdgeSnapshot,
  buildSharedHasSkillSeedSnapshot,
  buildSkillEndpointFragmentsSnapshot,
  EDGE_PROOF_EMPLOYEE,
  EDGE_PROOF_PAYRUN,
  EDGE_PROOF_PAYROLL_POLICY,
  EDGE_PROOF_TAX_CONFIG,
  edgeWriteProofFromBase64,
  GOVERNED_BY_POLICY_EDGE_ID,
  GOVERNED_BY_TAX_EDGE_ID,
} from "./edge-write-proof";

/**
 * FDN-92 Stage 3: the generic-edge write path, proven end to end in real
 * Chromium against the real `LocalGraphWorkerRuntime`, the real FDN-84
 * sealed store behind a real online unlock, real Loro WASM and real
 * SQLite-WASM.
 *
 * The edge writes go through `runtime.mutate` — the real `VPS-A004`
 * Gate-1-gated entrypoint (F131 / FDN-92) — so `authorizeEdgeWrite` and its
 * registry-declared governing-partition resolution are on the path under
 * proof, not stubbed. Endpoint node fragments are seeded through the
 * unchecked `applyDeltaBatch` (scaffolding, exactly as `chain-proof.ts`
 * seeds its employees); every assertion turns on the edge.
 *
 * A second, test-only Worker rather than a production protocol message, for
 * the same reason `runtime-chain-proof.worker.ts` is one: reading query
 * results back over `packages/graph`'s protocol would be an
 * application-facing read path F105 reserves for FDN-53. This constructs the
 * runtime directly.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

const AS_OF = "2026-03-01T00:00:00.000Z";
const FIELD_PATCH_EFFECTIVE_TO = "2026-06-01T00:00:00.000Z";

type Request =
  | {
      readonly kind: "union";
      readonly workspaceIdAB: string;
      readonly workspaceIdBA: string;
      readonly apiOrigin: string;
    }
  | {
      readonly kind: "field-by-field";
      readonly workspaceId: string;
      readonly apiOrigin: string;
    }
  | {
      readonly kind: "reopen";
      readonly workspaceId: string;
      readonly apiOrigin: string;
    }
  | {
      readonly kind: "governed-by";
      readonly workspaceId: string;
      readonly apiOrigin: string;
    }
  | {
      readonly kind: "denied";
      readonly workspaceId: string;
      readonly apiOrigin: string;
    }
  | {
      readonly kind: "offline-open";
      readonly workspaceId: string;
      readonly apiOrigin: string;
    }
  | { readonly kind: "offline-prove" };

function requireIndex(runtime: LocalGraphWorkerRuntime): SQLiteGraphIndex {
  const index = runtime.materializedIndexForDiagnostics;
  if (index === null) throw new Error("The runtime has no materialized index");
  return index;
}

async function outgoing(
  index: SQLiteGraphIndex,
  edgeType: string,
  fromNodeType: string,
  toNodeType: string,
): Promise<
  {
    edgeId: string;
    edgeType: string;
    toNodeId: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    metadata: unknown;
  }[]
> {
  const result = await index.execute(
    parseGraphQuery({
      kind: "edge-neighbors",
      startNodeId: EDGE_PROOF_EMPLOYEE,
      direction: "outgoing",
      asOf: AS_OF,
      edgeType,
      fromNodeType,
      toNodeType,
      limit: 20,
    }),
  );
  if (result.kind !== "edge-neighbors") throw new Error("Unexpected query result");
  return result.neighbors.map((neighbor) => ({
    edgeId: neighbor.edge.edge_id,
    edgeType: neighbor.edge.edge_type,
    toNodeId: neighbor.node.nodeId,
    effectiveFrom: neighbor.edge.effective_from,
    effectiveTo: neighbor.edge.effective_to,
    metadata: neighbor.edge.metadata,
  }));
}

/**
 * The `to_node_id` of every materialized `governed_by` edge out of the proof
 * PayRun. `edge-neighbors` filters on the from/to *types*, and PayRun's two
 * governors are different types (PayrollPolicy, TaxConfig), so a single
 * traversal query cannot ask for "both" — this reads the two edges straight
 * out of the deterministic canonical index snapshot instead, which is
 * exactly where a key scheme that collapsed `(edge_type, from_node_id)`
 * would show only one row.
 */
function governedByOutgoing(index: SQLiteGraphIndex): string[] {
  const snapshot = JSON.parse(index.canonicalSnapshot()) as {
    edges: {
      record: { edge_type: string; from_node_id: string; to_node_id: string };
    }[];
  };
  return snapshot.edges
    .filter(
      ({ record }) =>
        record.edge_type === "governed_by" && record.from_node_id === EDGE_PROOF_PAYRUN,
    )
    .map(({ record }) => record.to_node_id)
    .sort();
}

async function openRuntime(
  workspaceId: string,
  apiOrigin: string,
): Promise<LocalGraphWorkerRuntime> {
  const runtime = new LocalGraphWorkerRuntime();
  await runtime.unlockSealedStore(workspaceId, apiOrigin);
  await runtime.initialize(workspaceId);
  return runtime;
}

function bytes(base64: string): ArrayBuffer {
  return edgeWriteProofFromBase64(base64).slice().buffer;
}

/** Test 1: two devices, two edge types, merged in both orders — the queried
 * result and the canonical index are identical regardless of order. */
async function runUnion(request: Extract<Request, { kind: "union" }>) {
  await initializeLoro();
  const hasSkill = buildHasSkillEdgeSnapshot();
  const holdsCert = buildHoldsCertificationEdgeSnapshot();

  async function converge(workspaceId: string, order: "AB" | "BA") {
    const runtime = await openRuntime(workspaceId, request.apiOrigin);
    try {
      await runtime.applyDeltaBatch([
        bytes(buildSkillEndpointFragmentsSnapshot(workspaceId)),
      ]);
      const first = order === "AB" ? hasSkill : holdsCert;
      const second = order === "AB" ? holdsCert : hasSkill;
      const firstOutcome = await runtime.mutate([bytes(first)]);
      const secondOutcome = await runtime.mutate([bytes(second)]);
      const index = requireIndex(runtime);
      const skillEdges = await outgoing(index, "has_skill", "Employee", "Skill");
      const certEdges = await outgoing(
        index,
        "holds_certification",
        "Employee",
        "Certification",
      );
      // A workspace-independent canonical form of the materialized edges:
      // the full edge rows the query answered with, sorted by edge_id. The
      // SQLite `canonicalSnapshot()` also carries node rows whose
      // `workspace_id` differs between the two workspaces this test needs,
      // so the edge projection is what "identical regardless of merge order"
      // is asserted on.
      const edgeCanonical = JSON.stringify(
        [...skillEdges, ...certEdges].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
      );
      return {
        statuses: [firstOutcome.status, secondOutcome.status],
        skillToNodeIds: skillEdges.map((edge) => edge.toNodeId),
        certToNodeIds: certEdges.map((edge) => edge.toNodeId),
        edgeCanonical,
      };
    } finally {
      await runtime.dispose();
    }
  }

  const ab = await converge(request.workspaceIdAB, "AB");
  const ba = await converge(request.workspaceIdBA, "BA");
  return { ab, ba };
}

/** Test 2: both devices write the SAME edge_id, different fields. One edge
 * survives with both fields — the per-edge nested LoroMap merged field by
 * field rather than clobbering. */
async function runFieldByField(request: Extract<Request, { kind: "field-by-field" }>) {
  await initializeLoro();
  const runtime = await openRuntime(request.workspaceId, request.apiOrigin);
  try {
    await runtime.applyDeltaBatch([
      bytes(buildSkillEndpointFragmentsSnapshot(request.workspaceId)),
    ]);
    const seed = buildSharedHasSkillSeedSnapshot();
    await runtime.mutate([bytes(seed)]);
    const patchA = buildHasSkillFieldPatchSnapshot(
      seed,
      "effective_to",
      FIELD_PATCH_EFFECTIVE_TO,
      201n,
    );
    const patchB = buildHasSkillFieldPatchSnapshot(
      seed,
      "metadata",
      { proficiency: "expert" },
      202n,
    );
    const outcomeA = await runtime.mutate([bytes(patchA)]);
    const outcomeB = await runtime.mutate([bytes(patchB)]);
    const edges = await outgoing(
      requireIndex(runtime),
      "has_skill",
      "Employee",
      "Skill",
    );
    return {
      statuses: [outcomeA.status, outcomeB.status],
      edgeCount: edges.length,
      effectiveTo: edges[0]?.effectiveTo ?? null,
      metadata: edges[0]?.metadata ?? null,
    };
  } finally {
    await runtime.dispose();
  }
}

/** Test 3 + both mutation spot-checks: write, re-apply the same bytes (the
 * work runs again — generation advances — rather than being skipped), then
 * close and reopen on a genuinely separate runtime whose SQLite index
 * starts empty. */
async function runReopen(request: Extract<Request, { kind: "reopen" }>) {
  await initializeLoro();
  const first = await openRuntime(request.workspaceId, request.apiOrigin);
  let generationAfterWrite = -1;
  let generationAfterReapply = -1;
  let canonicalBeforeReopen = "";
  let toNodeIdsBeforeReopen: string[] = [];
  try {
    await first.applyDeltaBatch([
      bytes(buildSkillEndpointFragmentsSnapshot(request.workspaceId)),
    ]);
    const hasSkill = buildHasSkillEdgeSnapshot();
    const written = await first.mutate([bytes(hasSkill)]);
    if (written.status !== "applied") {
      throw new Error(
        `has_skill write was ${written.status}: ${JSON.stringify(written)}`,
      );
    }
    generationAfterWrite = written.materializationGeneration;
    const reapplied = await first.mutate([bytes(hasSkill)]);
    if (reapplied.status !== "applied") {
      throw new Error(`re-apply was ${reapplied.status}`);
    }
    generationAfterReapply = reapplied.materializationGeneration;
    const index = requireIndex(first);
    toNodeIdsBeforeReopen = (
      await outgoing(index, "has_skill", "Employee", "Skill")
    ).map((edge) => edge.toNodeId);
    canonicalBeforeReopen = index.canonicalSnapshot();
  } finally {
    await first.dispose();
  }

  const second = await openRuntime(request.workspaceId, request.apiOrigin);
  try {
    const index = requireIndex(second);
    const toNodeIdsAfterReopen = (
      await outgoing(index, "has_skill", "Employee", "Skill")
    ).map((edge) => edge.toNodeId);
    return {
      generationAfterWrite,
      generationAfterReapply,
      canonicalBeforeReopen,
      canonicalAfterReopen: index.canonicalSnapshot(),
      toNodeIdsBeforeReopen,
      toNodeIdsAfterReopen,
    };
  } finally {
    await second.dispose();
  }
}

/** Test 4: PayRun holds two `governed_by` edges — to a PayrollPolicy and a
 * TaxConfig. They must survive as two distinct fragments; a key scheme that
 * collapsed `(edge_type, from)` would keep only one. */
async function runGovernedBy(request: Extract<Request, { kind: "governed-by" }>) {
  await initializeLoro();
  const runtime = await openRuntime(request.workspaceId, request.apiOrigin);
  try {
    await runtime.applyDeltaBatch([
      bytes(buildFinanceEndpointFragmentsSnapshot(request.workspaceId)),
    ]);
    const toPolicy = await runtime.mutate([
      bytes(
        buildGovernedByEdgeSnapshot(
          GOVERNED_BY_POLICY_EDGE_ID,
          EDGE_PROOF_PAYROLL_POLICY,
          301n,
        ),
      ),
    ]);
    const toTax = await runtime.mutate([
      bytes(
        buildGovernedByEdgeSnapshot(
          GOVERNED_BY_TAX_EDGE_ID,
          EDGE_PROOF_TAX_CONFIG,
          302n,
        ),
      ),
    ]);
    return {
      statuses: [toPolicy.status, toTax.status],
      governorNodeIds: governedByOutgoing(requireIndex(runtime)),
    };
  } finally {
    await runtime.dispose();
  }
}

/** The Q3 precondition, proven negatively: a role that is only Read on
 * Employee/operational (finance-admin) cannot write `has_skill`. */
async function runDenied(request: Extract<Request, { kind: "denied" }>) {
  await initializeLoro();
  const runtime = await openRuntime(request.workspaceId, request.apiOrigin);
  try {
    await runtime.applyDeltaBatch([
      bytes(buildSkillEndpointFragmentsSnapshot(request.workspaceId)),
    ]);
    const outcome = await runtime.mutate([bytes(buildHasSkillEdgeSnapshot())]);
    return {
      status: outcome.status,
      reason: outcome.status === "denied" ? outcome.reason : "",
    };
  } finally {
    await runtime.dispose();
  }
}

// Test 5: offline. Two-step, same shape as runtime-offline-proof.worker.ts —
// the unlock is a deliberate server round-trip (F106), so `open` runs online
// and `prove` runs after the test cuts the network.
let offlineRuntime: LocalGraphWorkerRuntime | null = null;

async function offlineOpen(workspaceId: string, apiOrigin: string) {
  await initializeLoro();
  offlineRuntime = await openRuntime(workspaceId, apiOrigin);
  await offlineRuntime.applyDeltaBatch([
    bytes(buildSkillEndpointFragmentsSnapshot(workspaceId)),
  ]);
  return { opened: true };
}

async function offlineProve() {
  if (offlineRuntime === null) throw new Error("offline-prove before offline-open");
  const generationBefore = await requireIndex(offlineRuntime).generation;
  const outcome = await offlineRuntime.mutate([bytes(buildHasSkillEdgeSnapshot())]);
  const index = requireIndex(offlineRuntime);
  const edges = await outgoing(index, "has_skill", "Employee", "Skill");
  const result = {
    status: outcome.status,
    generationBefore,
    generationAfter: await index.generation,
    toNodeIds: edges.map((edge) => edge.toNodeId),
    canonical: index.canonicalSnapshot(),
  };
  await offlineRuntime.dispose();
  offlineRuntime = null;
  return result;
}

async function dispatch(request: Request): Promise<unknown> {
  switch (request.kind) {
    case "union":
      return runUnion(request);
    case "field-by-field":
      return runFieldByField(request);
    case "reopen":
      return runReopen(request);
    case "governed-by":
      return runGovernedBy(request);
    case "denied":
      return runDenied(request);
    case "offline-open":
      return offlineOpen(request.workspaceId, request.apiOrigin);
    case "offline-prove":
      return offlineProve();
  }
}

scope.onmessage = (event: MessageEvent<unknown>) => {
  void dispatch(event.data as Request)
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown edge write proof failure",
      }),
    );
};
