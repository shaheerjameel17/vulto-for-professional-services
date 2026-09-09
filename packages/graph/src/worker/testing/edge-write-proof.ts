import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";
import { EDGE_FRAGMENT_CONTAINER } from "../document-edge-fragments";

/**
 * FDN-92 Stage 3: the fixtures for the generic-edge write-path proof.
 *
 * Same category as `chain-proof.ts` and `permission-proof.ts`: every
 * function here builds a SCRATCH `LoroDoc` the caller then hands to the real
 * runtime as ordinary CRDT bytes. None of them touches the Worker's own
 * document and none is reachable from an application — the edge write path
 * under proof is `runtime.mutate`, the real `VPS-A004` Gate-1-gated
 * entrypoint (F131 / FDN-92), not anything in this file.
 *
 * The endpoint node fragments are scaffolding — seeded through the unchecked
 * `applyDeltaBatch` exactly as `chain-proof.ts` seeds its three employees —
 * so that the thing every assertion turns on is the edge write, which goes
 * through `mutate` and its registry-declared governing-partition resolution.
 */

const ACTOR = "77777777-7777-4777-8777-777777777777";

export const EDGE_PROOF_EMPLOYEE = "e0000000-0000-4000-8000-000000000001";
export const EDGE_PROOF_SKILL = "e0000000-0000-4000-8000-000000000002";
export const EDGE_PROOF_CERTIFICATION = "e0000000-0000-4000-8000-000000000003";
export const EDGE_PROOF_PAYRUN = "e0000000-0000-4000-8000-000000000004";
export const EDGE_PROOF_PAYROLL_POLICY = "e0000000-0000-4000-8000-000000000005";
export const EDGE_PROOF_TAX_CONFIG = "e0000000-0000-4000-8000-000000000006";

export const HAS_SKILL_EDGE_ID = "ed000000-0000-4000-8000-0000000000a1";
export const HOLDS_CERTIFICATION_EDGE_ID = "ed000000-0000-4000-8000-0000000000a2";
export const GOVERNED_BY_POLICY_EDGE_ID = "ed000000-0000-4000-8000-0000000000b1";
export const GOVERNED_BY_TAX_EDGE_ID = "ed000000-0000-4000-8000-0000000000b2";
export const SHARED_HAS_SKILL_EDGE_ID = "ed000000-0000-4000-8000-0000000000c1";

const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

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

/**
 * One node fragment as its OWN nested `LoroMap`, the layout
 * `document-node-fragments.ts` defines.
 */
function writeNodeFragment(
  document: LoroDoc,
  workspaceId: string,
  nodeId: string,
  nodeType: string,
  partitionKey: string,
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(nodeId, partitionKey), new LoroMap());
  const record: Record<string, unknown> = {
    node_id: nodeId,
    workspace_id: workspaceId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2025-12-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2025-12-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

/** The `has_skill` / `holds_certification` endpoints: one Employee, one
 * Skill, one Certification. Employee is split — only its `operational`
 * partition is seeded, which is the partition the registry declares governs
 * both those edge types. */
export function buildSkillEndpointFragmentsSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(60n);
  writeNodeFragment(
    document,
    workspaceId,
    EDGE_PROOF_EMPLOYEE,
    "Employee",
    "operational",
  );
  writeNodeFragment(document, workspaceId, EDGE_PROOF_SKILL, "Skill", "record");
  writeNodeFragment(
    document,
    workspaceId,
    EDGE_PROOF_CERTIFICATION,
    "Certification",
    "record",
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/** The `governed_by` endpoints: one PayRun and its two independent
 * governors, a PayrollPolicy and a TaxConfig. All three single-partition,
 * Finance-restricted — this test does not depend on the split-endpoint
 * ruling at all. */
export function buildFinanceEndpointFragmentsSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(63n);
  writeNodeFragment(document, workspaceId, EDGE_PROOF_PAYRUN, "PayRun", "record");
  writeNodeFragment(
    document,
    workspaceId,
    EDGE_PROOF_PAYROLL_POLICY,
    "PayrollPolicy",
    "record",
  );
  writeNodeFragment(
    document,
    workspaceId,
    EDGE_PROOF_TAX_CONFIG,
    "TaxConfig",
    "record",
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

interface EdgeFields {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly effectiveTo?: string | null;
  readonly metadata?: Record<string, unknown>;
}

function edgeRecord(fields: EdgeFields): Record<string, unknown> {
  return {
    edge_id: fields.edgeId,
    edge_type: fields.edgeType,
    from_node_id: fields.fromNodeId,
    to_node_id: fields.toNodeId,
    effective_from: EFFECTIVE_FROM,
    effective_to: fields.effectiveTo ?? null,
    created_at: EFFECTIVE_FROM,
    created_by: ACTOR,
    metadata: fields.metadata ?? {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

/**
 * Writes one edge fragment as its OWN nested `LoroMap` keyed by `edge_id`,
 * the layout `document-edge-fragments.ts` defines and the reason two devices
 * that touch different fields of one edge merge field by field.
 */
function writeEdgeFragment(document: LoroDoc, record: Record<string, unknown>): void {
  const fragment = document
    .getMap(EDGE_FRAGMENT_CONTAINER)
    .setContainer(String(record["edge_id"]), new LoroMap());
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

/** Device A, offline: `has_skill(employee -> skill)`. */
export function buildHasSkillEdgeSnapshot(): string {
  const document = new LoroDoc();
  document.setPeerId(61n);
  writeEdgeFragment(
    document,
    edgeRecord({
      edgeId: HAS_SKILL_EDGE_ID,
      edgeType: "has_skill",
      fromNodeId: EDGE_PROOF_EMPLOYEE,
      toNodeId: EDGE_PROOF_SKILL,
    }),
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/** Device B, offline: `holds_certification(employee -> certification)`. */
export function buildHoldsCertificationEdgeSnapshot(): string {
  const document = new LoroDoc();
  document.setPeerId(62n);
  writeEdgeFragment(
    document,
    edgeRecord({
      edgeId: HOLDS_CERTIFICATION_EDGE_ID,
      edgeType: "holds_certification",
      fromNodeId: EDGE_PROOF_EMPLOYEE,
      toNodeId: EDGE_PROOF_CERTIFICATION,
    }),
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/** The shared base for the field-by-field test: the `has_skill` edge with
 * only its opening fields, authored by neither device. */
export function buildSharedHasSkillSeedSnapshot(): string {
  const document = new LoroDoc();
  document.setPeerId(64n);
  writeEdgeFragment(
    document,
    edgeRecord({
      edgeId: SHARED_HAS_SKILL_EDGE_ID,
      edgeType: "has_skill",
      fromNodeId: EDGE_PROOF_EMPLOYEE,
      toNodeId: EDGE_PROOF_SKILL,
    }),
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * Patches one key of the shared `has_skill` edge, authored on a document
 * that has seen only the shared seed — a genuinely separate `LoroDoc` with
 * its own peer id, so the two patches are concurrent.
 */
export function buildHasSkillFieldPatchSnapshot(
  seedBase64: string,
  key: "effective_to" | "metadata",
  value: unknown,
  peerId: bigint,
): string {
  const document = new LoroDoc();
  document.setPeerId(peerId);
  document.import(fromBase64(seedBase64));
  const container = document.getMap(EDGE_FRAGMENT_CONTAINER);
  const fragment = container.get(SHARED_HAS_SKILL_EDGE_ID);
  if (!(fragment instanceof LoroMap)) {
    throw new Error("shared has_skill seed is missing its edge fragment");
  }
  fragment.set(key, value);
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/** One `governed_by(payRun -> governor)` edge. Called twice with different
 * `edge_id` and different `to` node, to prove the two survive as distinct
 * fragments rather than colliding on `(edge_type, from)`. */
export function buildGovernedByEdgeSnapshot(
  edgeId: string,
  toNodeId: string,
  peerId: bigint,
): string {
  const document = new LoroDoc();
  document.setPeerId(peerId);
  writeEdgeFragment(
    document,
    edgeRecord({
      edgeId,
      edgeType: "governed_by",
      fromNodeId: EDGE_PROOF_PAYRUN,
      toNodeId,
    }),
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

export { fromBase64 as edgeWriteProofFromBase64 };
