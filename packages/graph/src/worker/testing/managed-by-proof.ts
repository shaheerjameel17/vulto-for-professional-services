import { LoroDoc } from "loro-crdt/web";
import {
  applyTreeMove,
  createEmployeeTreeNode,
  materializeManagedByEdges,
  ORG_HIERARCHY_TREE,
} from "../managed-by-materialization";

/**
 * FDN-50 stage 4: the test-only seam for the `managed_by` materialization
 * proof.
 *
 * Reachable only through `@vulto/graph/testing`, deliberately NOT through
 * the package's main export. Per F105, FDN-53 is the first
 * application-callable read or write path over graph state, and nothing
 * here may become one by accident: the browser proof drives this module
 * from the diagnostics page, exactly as stage 1 drives `applyDeltaBatch`
 * with synthetic Loro bytes, and no production surface is added.
 *
 * Everything below builds GENUINELY SEPARATE `LoroDoc` instances. The
 * concurrency proof F104 was closed on requires a real merge of two real
 * offline documents — never one document simulating two, and never a
 * mocked merge — so a helper that faked it would defeat the only thing
 * this file exists to establish.
 */

const WORKSPACE_ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
const MANAGER_A = "123e4567-e89b-42d3-a456-426614174003";
const MANAGER_B = "123e4567-e89b-42d3-a456-426614174004";

export const PROOF_EMPLOYEE = EMPLOYEE;
export const PROOF_MANAGER_A = MANAGER_A;
export const PROOF_MANAGER_B = MANAGER_B;

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

function findNode(document: LoroDoc, employeeId: string) {
  const node = document
    .getTree(ORG_HIERARCHY_TREE)
    .nodes()
    .find((candidate) => candidate.data.get("employee_node_id") === employeeId);
  if (node === undefined) throw new Error(`No tree node for ${employeeId}`);
  return node;
}

export interface ConcurrentMoveProofSnapshots {
  readonly seed: string;
  readonly deviceA: string;
  readonly deviceB: string;
}

/**
 * Builds the F104 scenario: a shared seed, then two separate offline
 * documents that each move the SAME employee to a DIFFERENT manager.
 *
 * Peers are pinned (21 and 22) so the proof is reproducible rather than
 * dependent on Loro's random peer assignment. This is the same pair F124's
 * own recorded evidence used.
 */
export function buildConcurrentMoveSnapshots(): ConcurrentMoveProofSnapshots {
  const seedDocument = new LoroDoc();
  seedDocument.setPeerId(1n);
  const tree = seedDocument.getTree(ORG_HIERARCHY_TREE);
  createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
  createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
  createEmployeeTreeNode(tree, EMPLOYEE, undefined, undefined);
  seedDocument.commit();
  const seed = seedDocument.export({ mode: "snapshot" });

  const deviceA = new LoroDoc();
  deviceA.setPeerId(21n);
  deviceA.import(seed);
  applyTreeMove(findNode(deviceA, EMPLOYEE), findNode(deviceA, MANAGER_A), {
    employeeNodeId: EMPLOYEE,
    effectiveFrom: "2026-03-01T00:00:00.000Z",
    recordedAt: "2026-02-20T08:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  deviceA.commit();

  const deviceB = new LoroDoc();
  deviceB.setPeerId(22n);
  deviceB.import(seed);
  applyTreeMove(findNode(deviceB, EMPLOYEE), findNode(deviceB, MANAGER_B), {
    employeeNodeId: EMPLOYEE,
    effectiveFrom: "2026-04-01T00:00:00.000Z",
    recordedAt: "2026-03-25T08:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  deviceB.commit();

  const result: ConcurrentMoveProofSnapshots = {
    seed: toBase64(seed),
    deviceA: toBase64(deviceA.export({ mode: "snapshot" })),
    deviceB: toBase64(deviceB.export({ mode: "snapshot" })),
  };
  seedDocument.free();
  deviceA.free();
  deviceB.free();
  return result;
}

/**
 * A single-device forward-effective history: one placement, then one move.
 * Materializes to exactly one close-plus-open pair.
 */
export function buildSequentialMoveSnapshot(): string {
  const document = new LoroDoc();
  document.setPeerId(31n);
  const tree = document.getTree(ORG_HIERARCHY_TREE);
  const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
  const managerB = createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
  const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    recordedAt: "2025-12-20T08:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  document.commit();
  applyTreeMove(employee, managerB, {
    employeeNodeId: EMPLOYEE,
    effectiveFrom: "2026-03-01T00:00:00.000Z",
    recordedAt: "2026-02-20T11:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/** A move whose effective date precedes the interval it would replace. */
export function buildBackdatedMoveSnapshot(): string {
  const document = new LoroDoc();
  document.setPeerId(41n);
  const tree = document.getTree(ORG_HIERARCHY_TREE);
  const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
  const managerB = createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
  const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    recordedAt: "2026-04-20T08:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  document.commit();
  applyTreeMove(employee, managerB, {
    employeeNodeId: EMPLOYEE,
    effectiveFrom: "2026-02-01T00:00:00.000Z",
    recordedAt: "2026-04-21T08:00:00.000Z",
    movedBy: WORKSPACE_ACTOR,
  });
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * Imports the given snapshots into ONE fresh document, in the order given,
 * and returns the materialized `managed_by` history as a readable summary
 * plus its canonical JSON.
 *
 * The caller controls merge order, which is the whole point: the proof runs
 * this twice with the orders reversed and compares.
 */
export async function materializeFromSnapshots(
  base64Snapshots: readonly string[],
): Promise<{ summary: string[]; canonical: string }> {
  const document = new LoroDoc();
  document.setPeerId(99n);
  try {
    for (const snapshot of base64Snapshots) document.import(fromBase64(snapshot));
    const { edges } = await materializeManagedByEdges(document);
    const summary = edges.map((edge) => {
      const value = edge.record as {
        from_node_id: string;
        to_node_id: string;
        effective_from: string | null;
        effective_to: string | null;
      };
      return `${value.from_node_id} -> ${value.to_node_id} [${String(value.effective_from)}, ${String(value.effective_to)})`;
    });
    return { summary, canonical: JSON.stringify(edges) };
  } finally {
    document.free();
  }
}

/** The Tree's own resolved parent for the proof employee, as a node id. */
export function resolvedManagerOf(base64Snapshots: readonly string[]): string | null {
  const document = new LoroDoc();
  document.setPeerId(98n);
  try {
    for (const snapshot of base64Snapshots) document.import(fromBase64(snapshot));
    const parent = findNode(document, EMPLOYEE).parent();
    if (parent === undefined) return null;
    const value = parent.data.get("employee_node_id");
    return typeof value === "string" ? value : null;
  } finally {
    document.free();
  }
}
