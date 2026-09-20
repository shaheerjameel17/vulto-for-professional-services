import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";
import { EDGE_FRAGMENT_CONTAINER } from "../document-edge-fragments";

export const AUDIT_LOCAL_IDS = {
  tier0: "68300000-0000-4000-8000-000000000001",
  tier1: "68300000-0000-4000-8000-000000000002",
  tier1Second: "68300000-0000-4000-8000-000000000007",
  tier2: "68300000-0000-4000-8000-000000000003",
  tier3: "68300000-0000-4000-8000-000000000004",
  skill: "68300000-0000-4000-8000-000000000005",
  failedSkill: "68300000-0000-4000-8000-000000000006",
  tier1Mutation: "68300000-0000-4000-8000-000000000008",
  deniedMutation: "68300000-0000-4000-8000-000000000009",
  tier1Edge: "68300000-0000-4000-8000-00000000000a",
} as const;

const ACTOR = "68300000-0000-4000-8000-000000000099";
const NOW = "2026-09-10T10:00:00.000Z";

function writeRecord(
  document: LoroDoc,
  workspaceId: string,
  nodeId: string,
  nodeType: string,
  lifecycleStatus: string,
  extra: Record<string, unknown> = {},
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(nodeId, "record"), new LoroMap());
  const record = {
    node_id: nodeId,
    workspace_id: workspaceId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: lifecycleStatus,
    created_at: NOW,
    created_by: ACTOR,
    updated_at: NOW,
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...extra,
  };
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

function exportSnapshot(document: LoroDoc): Uint8Array {
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return bytes;
}

export function buildAuditLocalSeed(workspaceId: string): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(6830n);
  writeRecord(
    document,
    workspaceId,
    AUDIT_LOCAL_IDS.tier0,
    "HeadcountSnapshot",
    "Recorded",
  );
  writeRecord(document, workspaceId, AUDIT_LOCAL_IDS.tier1, "RateCard", "Active", {
    confidential_rate: 98_765,
  });
  writeRecord(document, workspaceId, AUDIT_LOCAL_IDS.tier1Second, "RateCard", "Active");
  writeRecord(
    document,
    workspaceId,
    AUDIT_LOCAL_IDS.tier2,
    "FlightRiskSignal",
    "Active",
  );
  writeRecord(
    document,
    workspaceId,
    AUDIT_LOCAL_IDS.tier3,
    "WellnessTriggerEvent",
    "Active",
  );
  writeRecord(document, workspaceId, AUDIT_LOCAL_IDS.skill, "Skill", "Active", {
    name: "Audit journal proof skill",
  });
  return exportSnapshot(document);
}

export function buildAuthorizedFailureMutation(workspaceId: string): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(6831n);
  writeRecord(document, workspaceId, AUDIT_LOCAL_IDS.failedSkill, "Skill", "Active", {
    name: "Must not commit after forced failure",
  });
  return exportSnapshot(document);
}

export function buildTier1Mutation(workspaceId: string): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(6832n);
  writeRecord(
    document,
    workspaceId,
    AUDIT_LOCAL_IDS.tier1Mutation,
    "RateCard",
    "Active",
  );
  return exportSnapshot(document);
}

export function buildDeniedMutation(workspaceId: string): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(6833n);
  writeRecord(
    document,
    workspaceId,
    AUDIT_LOCAL_IDS.deniedMutation,
    "OrgScenario",
    "Draft",
  );
  return exportSnapshot(document);
}

export function buildTier1EdgeMutation(): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(6834n);
  const edge = document
    .getMap(EDGE_FRAGMENT_CONTAINER)
    .setContainer(AUDIT_LOCAL_IDS.tier1Edge, new LoroMap());
  const record = {
    edge_id: AUDIT_LOCAL_IDS.tier1Edge,
    edge_type: "supersedes",
    from_node_id: AUDIT_LOCAL_IDS.tier1,
    to_node_id: AUDIT_LOCAL_IDS.tier1Second,
    effective_from: NOW,
    effective_to: null,
    created_at: NOW,
    created_by: ACTOR,
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
  for (const [key, value] of Object.entries(record)) edge.set(key, value);
  return exportSnapshot(document);
}
