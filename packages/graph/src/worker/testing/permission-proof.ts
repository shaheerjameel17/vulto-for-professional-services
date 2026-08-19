import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";

/**
 * FDN-53 stage 1's own browser-proof fixture, in the same category as
 * `chain-proof.ts`'s `writeNodeFragment`: a scratch-document builder the
 * real `applyDeltaBatch` entrypoint consumes as ordinary CRDT bytes, never
 * a new local-mutation surface. Kept in its own file rather than added to
 * `chain-proof.ts` so this stage does not touch FDN-50's own machinery at
 * all — per this stage's process rules, only reads from it.
 */

const ACTOR = "44444444-4444-4444-8444-444444444444";

export const PERMISSION_PROOF_EMPLOYEE = "55555555-5555-4555-8555-555555555555";

function writeFragment(
  document: LoroDoc,
  workspaceId: string,
  nodeId: string,
  nodeType: string,
  partitionKey: string,
  extra: Record<string, unknown>,
): void {
  const container = document.getMap(NODE_FRAGMENT_CONTAINER);
  const fragment = container.setContainer(
    nodeFragmentKey(nodeId, partitionKey),
    new LoroMap(),
  );
  const record: Record<string, unknown> = {
    node_id: nodeId,
    workspace_id: workspaceId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2026-01-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2026-01-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...extra,
  };
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * One Employee, both partitions: `operational` (Standard, Tier 0) and
 * `compensation` (Finance-restricted, Tier 1) — the exact split
 * `VPS-A004`'s matrix names explicitly, so a browser proof can query it
 * through the real interceptor and see a real `Restricted` placeholder on
 * the compensation half for a role that should not read it in full.
 */
export function buildPermissionProofEmployeeSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(90n);
  writeFragment(
    document,
    workspaceId,
    PERMISSION_PROOF_EMPLOYEE,
    "Employee",
    "operational",
    {
      job_title: "Staff Engineer",
    },
  );
  writeFragment(
    document,
    workspaceId,
    PERMISSION_PROOF_EMPLOYEE,
    "Employee",
    "compensation",
    {
      base_salary: 175000,
    },
  );
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * `OrgScenario`'s Privacy Class is "Owner and HR Admin only": HR Admin
 * gets Full, Team Member gets structural `None`. Deliberately chosen for
 * the role-narrowing browser proof (F127) because the transition is
 * unambiguous — a node-get either returns the whole record or returns
 * `null`, nothing in between, no field-level nuance to misread.
 */
export function buildPermissionProofOrgScenarioSnapshot(
  workspaceId: string,
  nodeId: string,
): string {
  const document = new LoroDoc();
  document.setPeerId(91n);
  writeFragment(document, workspaceId, nodeId, "OrgScenario", "record", {
    scenario_name: "Reorg draft",
  });
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}
