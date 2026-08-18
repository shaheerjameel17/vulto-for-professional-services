import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";
import {
  applyTreeMove,
  createEmployeeTreeNode,
  ORG_HIERARCHY_TREE,
} from "../managed-by-materialization";
import { PROOF_EMPLOYEE, PROOF_MANAGER_A, PROOF_MANAGER_B } from "./managed-by-proof";

/**
 * FDN-50 stage 5: the fixtures for the complete-chain proof — a Tree move
 * and the node records its edges point at, in one Loro document, fed
 * through the real `applyDeltaBatch`.
 *
 * Test-only, in the same sense as everything else in this directory. These
 * functions build SCRATCH documents the caller then hands to the runtime as
 * ordinary CRDT bytes; none of them touches the Worker's own document, and
 * none of them is reachable from an application. Per F105, FDN-53 remains
 * the first application-callable read or write path over graph state.
 *
 * `writeNodeFragment` lives here rather than beside the reader in
 * `document-node-fragments.ts` on purpose: production code in this stage
 * READS the node-fragment layout and never writes it, and putting a writer
 * on the production module would quietly create the local-mutation surface
 * F105 reserves for FDN-53.
 */

const ACTOR = "123e4567-e89b-42d3-a456-426614174001";

export const CHAIN_EMPLOYEE = PROOF_EMPLOYEE;
export const CHAIN_MANAGER_A = PROOF_MANAGER_A;
export const CHAIN_MANAGER_B = PROOF_MANAGER_B;

/** The first reporting line's effective date, and the second's. */
export const CHAIN_FIRST_EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";
export const CHAIN_SECOND_EFFECTIVE_FROM = "2026-06-01T00:00:00.000Z";

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
 * Writes one Employee operational fragment as its OWN nested `LoroMap`,
 * which is the layout `document-node-fragments.ts` defines and the reason
 * two devices editing different fields of one person merge field by field
 * instead of clobbering the whole record.
 */
function writeNodeFragment(
  document: LoroDoc,
  workspaceId: string,
  nodeId: string,
  displayName: string,
): void {
  const container = document.getMap(NODE_FRAGMENT_CONTAINER);
  const fragment = container.setContainer(
    nodeFragmentKey(nodeId, "operational"),
    new LoroMap(),
  );
  const record: Record<string, unknown> = {
    node_id: nodeId,
    workspace_id: workspaceId,
    node_type: "Employee",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2025-12-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2025-12-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    display_name: displayName,
  };
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

/**
 * The three proof employees' node records ALONE, with no Tree at all.
 *
 * Exists because FDN-50 stage 5 wired materialization into the live
 * `applyDeltaBatch` path, which made a previously invisible requirement
 * real: a `managed_by` edge materialized from the Tree is refused unless
 * both of its endpoints are themselves materialized. Stage 4's browser
 * proof fed the runtime a Tree-only document, which was accepted while the
 * live path ignored the Tree and is correctly refused now. This lets that
 * proof hand the runtime a COMPLETE workspace document without changing
 * anything it asserts.
 */
export function buildProofEmployeeFragmentsSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(50n);
  writeNodeFragment(document, workspaceId, CHAIN_MANAGER_A, "Manager A");
  writeNodeFragment(document, workspaceId, CHAIN_MANAGER_B, "Manager B");
  writeNodeFragment(document, workspaceId, CHAIN_EMPLOYEE, "Employee");
  document.commit();

  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * The workspace's opening state: three Employees as node fragments, three
 * Tree nodes, and the employee placed under manager A with an effective
 * date carried on the move (F124).
 *
 * One document holding both halves, because that is what the Worker
 * actually receives — the node records and the Tree are the same
 * workspace's state, not two feeds.
 */
export function buildEmployeeGraphSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(51n);
  writeNodeFragment(document, workspaceId, CHAIN_MANAGER_A, "Manager A");
  writeNodeFragment(document, workspaceId, CHAIN_MANAGER_B, "Manager B");
  writeNodeFragment(document, workspaceId, CHAIN_EMPLOYEE, "Employee");

  const tree = document.getTree(ORG_HIERARCHY_TREE);
  const managerA = createEmployeeTreeNode(tree, CHAIN_MANAGER_A, undefined, undefined);
  createEmployeeTreeNode(tree, CHAIN_MANAGER_B, undefined, undefined);
  createEmployeeTreeNode(tree, CHAIN_EMPLOYEE, managerA, {
    effectiveFrom: CHAIN_FIRST_EFFECTIVE_FROM,
    recordedAt: "2025-12-20T08:00:00.000Z",
    movedBy: ACTOR,
  });
  document.commit();

  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * A later, forward-effective move of the same employee to manager B,
 * authored on a document that has seen the opening state — an ordinary
 * second delta, not a replacement snapshot.
 */
export function buildReassignmentSnapshot(base64Snapshot: string): string {
  const document = new LoroDoc();
  document.setPeerId(52n);
  document.import(fromBase64(base64Snapshot));

  const tree = document.getTree(ORG_HIERARCHY_TREE);
  const nodes = tree.nodes();
  const employee = nodes.find(
    (node) => node.data.get("employee_node_id") === CHAIN_EMPLOYEE,
  );
  const managerB = nodes.find(
    (node) => node.data.get("employee_node_id") === CHAIN_MANAGER_B,
  );
  if (employee === undefined || managerB === undefined) {
    throw new Error("The opening snapshot is missing its Tree nodes");
  }
  applyTreeMove(employee, managerB, {
    employeeNodeId: CHAIN_EMPLOYEE,
    effectiveFrom: CHAIN_SECOND_EFFECTIVE_FROM,
    recordedAt: "2026-05-20T08:00:00.000Z",
    movedBy: ACTOR,
  });
  document.commit();

  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * A snapshot whose Tree names an employee that has NO node fragment, so
 * the materialized edge would point at an endpoint the index does not
 * hold. Used to prove the live path refuses it rather than writing a
 * dangling edge.
 */
export function buildDanglingEndpointSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(53n);
  writeNodeFragment(document, workspaceId, CHAIN_EMPLOYEE, "Employee");

  const tree = document.getTree(ORG_HIERARCHY_TREE);
  // Manager B gets a Tree node but deliberately no node fragment.
  const managerB = createEmployeeTreeNode(tree, CHAIN_MANAGER_B, undefined, undefined);
  createEmployeeTreeNode(tree, CHAIN_EMPLOYEE, managerB, {
    effectiveFrom: CHAIN_FIRST_EFFECTIVE_FROM,
    recordedAt: "2025-12-20T08:00:00.000Z",
    movedBy: ACTOR,
  });
  document.commit();

  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

export { fromBase64 as chainProofFromBase64 };
