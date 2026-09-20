import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";

/**
 * FDN-68 Stage 1 fixtures. These build scratch CRDT snapshots only; the
 * browser proof sends every attempted create, alter, and remove through the
 * production `LocalGraphWorkerRuntime.mutate` gate. The initial AuditEntry
 * seed uses the pre-existing unchecked test seam solely so alter/remove have
 * a durable record to attempt to change.
 */

const ACTOR = "68686868-6868-4868-8868-686868686868";
const MEMBERSHIP = "68686868-6868-4868-8868-686868686869";
const CREATED_AT = "2026-09-10T09:00:00.000Z";

export const AUDIT_PROOF_EXISTING_ID = "68000000-0000-4000-8000-000000000001";
export const AUDIT_PROOF_CREATED_ID = "68000000-0000-4000-8000-000000000002";
export const AUDIT_PROOF_SKILL_ID = "68000000-0000-4000-8000-000000000003";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function writeRecord(
  document: LoroDoc,
  nodeId: string,
  partitionKey: string,
  record: Record<string, unknown>,
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(nodeId, partitionKey), new LoroMap());
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

function auditRecord(
  workspaceId: string,
  nodeId: string,
  eventType: string,
): Record<string, unknown> {
  const denied = eventType === "PermissionDenied";
  return {
    node_id: nodeId,
    workspace_id: workspaceId,
    node_type: "AuditEntry",
    schema_version: 1,
    lifecycle_status: "Recorded",
    created_at: CREATED_AT,
    created_by: ACTOR,
    actor_user_id: ACTOR,
    actor_membership_id: MEMBERSHIP,
    actor_role: denied ? null : "owner",
    actor_roles: ["owner"],
    actor_application: "VultoRoster",
    event_type: eventType,
    operation: "NodeRead",
    outcome: denied ? "Denied" : "Granted",
    target: {
      kind: "NodeTarget",
      node_type: "Skill",
      node_id: null,
      partition_key: "record",
      target_tier: 0,
    },
    metadata: denied
      ? { denial_class: "InsufficientPermission", result_cardinality: "Single" }
      : { result_cardinality: "Single" },
    occurred_at: CREATED_AT,
  };
}

function exportSnapshot(document: LoroDoc): string {
  document.commit();
  const snapshot = toBase64(document.export({ mode: "snapshot" }));
  document.free();
  return snapshot;
}

export interface AuditGenericMutationProofSnapshots {
  readonly seed: string;
  readonly create: string;
  readonly alter: string;
  readonly remove: string;
  readonly typeChange: string;
  readonly permittedSkillCreate: string;
}

export function buildAuditGenericMutationProofSnapshots(
  workspaceId: string,
): AuditGenericMutationProofSnapshots {
  const seedDocument = new LoroDoc();
  seedDocument.setPeerId(680n);
  writeRecord(
    seedDocument,
    AUDIT_PROOF_EXISTING_ID,
    "record",
    auditRecord(workspaceId, AUDIT_PROOF_EXISTING_ID, "PermissionDenied"),
  );
  seedDocument.commit();
  const seedBytes = seedDocument.export({ mode: "snapshot" });
  const seed = toBase64(seedBytes);
  seedDocument.free();

  const createDocument = new LoroDoc();
  createDocument.setPeerId(681n);
  writeRecord(
    createDocument,
    AUDIT_PROOF_CREATED_ID,
    "record",
    auditRecord(workspaceId, AUDIT_PROOF_CREATED_ID, "SensitiveAccessGranted"),
  );
  const create = exportSnapshot(createDocument);

  const alterDocument = new LoroDoc();
  alterDocument.setPeerId(682n);
  alterDocument.import(seedBytes);
  const existing = alterDocument
    .getMap(NODE_FRAGMENT_CONTAINER)
    .get(nodeFragmentKey(AUDIT_PROOF_EXISTING_ID, "record"));
  if (!(existing instanceof LoroMap)) {
    alterDocument.free();
    throw new Error("AuditEntry seed fragment is missing");
  }
  existing.set("event_type", "SensitiveAccessGranted");
  const alter = exportSnapshot(alterDocument);

  // A genuine, otherwise-valid AuditEntry -> Skill type change. Keeping the
  // same fragment identity while changing both the old type's lifecycle and
  // adding Skill's mutable universal fields means this would pass ordinary
  // Owner authorization and schema validation if the before-type reservation
  // were absent.
  const typeChangeDocument = new LoroDoc();
  typeChangeDocument.setPeerId(685n);
  typeChangeDocument.import(fromBase64(seed));
  const typeChanged = typeChangeDocument
    .getMap(NODE_FRAGMENT_CONTAINER)
    .get(nodeFragmentKey(AUDIT_PROOF_EXISTING_ID, "record"));
  if (!(typeChanged instanceof LoroMap)) {
    typeChangeDocument.free();
    throw new Error("AuditEntry type-change seed fragment is missing");
  }
  typeChanged.set("node_type", "Skill");
  typeChanged.set("lifecycle_status", "Active");
  typeChanged.set("updated_at", CREATED_AT);
  typeChanged.set("updated_by", ACTOR);
  typeChanged.set("is_soft_deleted", false);
  typeChanged.set("soft_deleted_at", null);
  typeChanged.set("soft_deleted_by", null);
  typeChanged.set("name", "Forbidden type change");
  const typeChange = exportSnapshot(typeChangeDocument);

  const removeDocument = new LoroDoc();
  removeDocument.setPeerId(683n);
  removeDocument.import(fromBase64(seed));
  removeDocument
    .getMap(NODE_FRAGMENT_CONTAINER)
    .delete(nodeFragmentKey(AUDIT_PROOF_EXISTING_ID, "record"));
  const remove = exportSnapshot(removeDocument);

  const permittedDocument = new LoroDoc();
  permittedDocument.setPeerId(684n);
  writeRecord(permittedDocument, AUDIT_PROOF_SKILL_ID, "record", {
    node_id: AUDIT_PROOF_SKILL_ID,
    workspace_id: workspaceId,
    node_type: "Skill",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: CREATED_AT,
    created_by: ACTOR,
    updated_at: CREATED_AT,
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    name: "Containment proof skill",
  });
  const permittedSkillCreate = exportSnapshot(permittedDocument);

  return { seed, create, alter, remove, typeChange, permittedSkillCreate };
}
