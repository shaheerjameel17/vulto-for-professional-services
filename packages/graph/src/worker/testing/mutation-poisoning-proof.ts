import { LoroDoc, LoroMap } from "loro-crdt/web";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "../document-node-fragments";

/**
 * F138's browser-proof fixtures.
 *
 * Same category as `permission-proof.ts` and `chain-proof.ts`: scratch-document
 * builders whose bytes the real, production `mutate` entrypoint consumes as
 * ordinary CRDT deltas. Nothing here is a new mutation surface — every
 * function returns opaque base64 snapshot bytes, exactly what an application
 * or a sync peer would hand `mutate`.
 *
 * **What these fixtures are for.** F138 is the discovery that `VPS-A004`'s
 * Gate 1 answers only "may this caller write this node type and partition,"
 * and nothing between the gate and the canonical Loro document asks whether
 * the resulting graph is COHERENT. A batch can be perfectly authorized and
 * still be refused by `materialization.ts` a moment later — at which point
 * the deltas are already merged into the canonical document, because a CRDT
 * merge is not undoable.
 *
 * The poisons below are the three vectors confirmed at unit level. They are
 * not exotic: a fragment carrying another workspace's id is exactly what a
 * mis-routed sync delta looks like, and two partitions disagreeing about
 * their own node's type is exactly what two devices editing different
 * partitions of one record can converge to.
 */

const ACTOR = "44444444-4444-4444-8444-444444444444";

/** The employee every fixture below writes, so a proof can query one known id. */
export const POISON_PROOF_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

/** A workspace id that is deliberately NOT the one under test. */
const FOREIGN_WORKSPACE = "99999999-9999-4999-8999-999999999999";

function writeFragment(
  document: LoroDoc,
  workspaceId: string,
  nodeId: string,
  nodeType: string,
  partitionKey: string,
  extra: Record<string, unknown> = {},
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
  return binary.length === 0 ? "" : btoa(binary);
}

function exportScratch(document: LoroDoc): string {
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return toBase64(bytes);
}

/**
 * A perfectly ordinary, coherent batch: `count` Employees, operational
 * partition only. Used both as the workspace's legitimate content and as the
 * lever that makes a full re-materialization take long enough to observe the
 * debounce window's behavior — `#materialize()`'s cost is bounded by
 * workspace size, which is the documented tradeoff, not a trick.
 */
export function buildBulkEmployeeSnapshot(workspaceId: string, count: number): string {
  const document = new LoroDoc();
  document.setPeerId(120n);
  for (let index = 0; index < count; index += 1) {
    const suffix = index.toString(16).padStart(12, "0");
    writeFragment(
      document,
      workspaceId,
      `88888888-8888-4888-8888-${suffix}`,
      "Employee",
      "operational",
      { job_title: `Engineer ${index}` },
    );
  }
  return exportScratch(document);
}

/** One ordinary, coherent Employee — the control case that must be authorized AND committed. */
export function buildCleanEmployeeSnapshot(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(121n);
  writeFragment(
    document,
    workspaceId,
    POISON_PROOF_EMPLOYEE,
    "Employee",
    "operational",
    { job_title: "Staff Engineer" },
  );
  return exportScratch(document);
}

/**
 * POISON 1 — a fragment carrying a foreign `workspace_id`.
 *
 * Gate 1 resolves `Employee/operational` for an Owner to `full` and
 * authorizes. `validateGraphSnapshot` then refuses with "belongs to workspace
 * X, not Y". Confirmed at unit level before this fixture was written.
 */
export function buildForeignWorkspacePoison(): string {
  const document = new LoroDoc();
  document.setPeerId(122n);
  writeFragment(
    document,
    FOREIGN_WORKSPACE,
    POISON_PROOF_EMPLOYEE,
    "Employee",
    "operational",
    { job_title: "Planted by another workspace" },
  );
  return exportScratch(document);
}

/**
 * POISON 2 — two partitions of one node id that disagree about their own
 * node type. Gate 1 checks each fragment independently (an Owner is `full` on
 * both Employee and Project), so both authorize; together they are incoherent
 * and `validateGraphSnapshot` refuses with "has conflicting node types".
 */
export function buildConflictingNodeTypePoison(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(123n);
  writeFragment(
    document,
    workspaceId,
    POISON_PROOF_EMPLOYEE,
    "Employee",
    "operational",
  );
  writeFragment(document, workspaceId, POISON_PROOF_EMPLOYEE, "Project", "record");
  return exportScratch(document);
}

/**
 * POISON 3 — a record whose `lifecycle_status` is not registered for its node
 * type. This one never reaches the coherence question: `parseNodeRecord`
 * throws a raw `ZodError` inside the gate itself, which `entry.ts` reports as
 * a FATAL `runtime-failure` and the client answers by terminating the Worker.
 * A malformed delta batch takes the Worker down instead of being refused.
 */
export function buildMalformedRecordPoison(workspaceId: string): string {
  const document = new LoroDoc();
  document.setPeerId(124n);
  writeFragment(
    document,
    workspaceId,
    POISON_PROOF_EMPLOYEE,
    "Employee",
    "operational",
    { lifecycle_status: "Archived" },
  );
  return exportScratch(document);
}
