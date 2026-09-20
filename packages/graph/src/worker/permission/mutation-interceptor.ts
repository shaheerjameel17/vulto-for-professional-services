import {
  assertRegisteredRelationship,
  getProtectionPartitions,
  POLICY_ROLES,
  parseEdgeRecord,
  parseNodeRecord,
  type EdgeRecord,
  type EdgeType,
  type AuditOperation,
  type AuditTargetReference,
  type DataTier,
  type JsonValue,
  type NodeRecord,
  type NodeType,
} from "@vulto/schema";
import type { LoroDoc } from "loro-crdt";
import { EDGE_FRAGMENT_CONTAINER, readEdgeFragments } from "../document-edge-fragments";
import { NODE_FRAGMENT_CONTAINER, readNodeFragments } from "../document-node-fragments";
import { materializeManagedByEdges } from "../managed-by-materialization";
import {
  validateGraphSnapshot,
  type EdgeInput,
  type NodeFragmentInput,
} from "../materialization";
import { canonicalJson } from "../storage/canonical-json";
import { bestResolution } from "./interceptor";
import {
  resolvePermissionDecision,
  type PermissionDecision,
  type PolicyRole,
} from "./policy-table";

/**
 * FDN-53 stage 2. The `VPS-A004` mutation interceptor's Gate 1: role-based
 * write permission.
 *
 * Per founder ruling on F131/F132/F133/F134/F135, this stage builds ONLY
 * Gate 1 (the ordinary role x privacy-class permission resolution, reused
 * unchanged from the read path's `resolvePermission`/`bestResolution`).
 * Gate 2 (`VPS-F008` cross-suite write authority) and Gate 3 (refusal when
 * a write would leave an empty reader set) are not built here — both
 * depend on infrastructure that does not exist yet (a second registered
 * application; the User-to-Employee identity link `VRS-F002` owns), and
 * building either now would be a dormant mechanism of exactly the shape
 * F130 already rejected. See F133 and F134.
 */

export interface MutationGrant {
  readonly allowed: true;
}

export interface MutationDenial {
  readonly allowed: false;
  readonly reason: string;
}

export type MutationAuthorization = MutationGrant | MutationDenial;

const GRANTED: MutationAuthorization = { allowed: true };

/**
 * Gate 1 for a single changed node fragment. `Full` is the only outcome
 * that authorizes a write — `Read`, `Restricted` and `None` all refuse,
 * mirroring VPS-A004's own statement that Full alone covers create, update,
 * and soft-delete.
 */
export function authorizeNodeWrite(
  nodeType: NodeType,
  partitionKey: string,
  roles: readonly PolicyRole[],
): MutationAuthorization {
  const resolution = bestResolution(roles, nodeType, partitionKey);
  if (resolution.outcome === "full") return GRANTED;
  return {
    allowed: false,
    reason: `No role in this caller's set resolves to Full (write) permission for ${nodeType}/${partitionKey}`,
  };
}

/**
 * Gate 1 for an edge write.
 *
 * `VPS-A004` assigns no Privacy Class or write-permission column to an edge
 * TYPE, only to node types and node-type partitions — the same gap the read
 * path's `interceptedEdgeNeighbors` documents for Read. The rule here: an
 * edge write requires **Full** write permission on both endpoint node types.
 *
 * Where an endpoint has more than one privacy partition (Employee's
 * operational/compensation split, Workspace's display/billing split), the
 * governing partition is a **static, reviewed declaration on the edge-type
 * registry** — `EdgeRegistration.governingPartitions`, keyed by node type
 * (F136, founder ruling: Option A refined). It is looked up here
 * independently; a write delta never supplies it, because a self-declared
 * scope would let a caller always name the innocuous partition and never be
 * checked against the sensitive one. A split endpoint with no registry
 * declaration resolves to `none` — the conservative F128/F136 default for
 * anything unreviewed. An inherited-protection endpoint (no concrete
 * partition) also resolves to `none`.
 */
export function authorizeEdgeWrite(
  edgeType: string,
  fromNodeType: NodeType,
  toNodeType: NodeType,
  roles: readonly PolicyRole[],
): MutationAuthorization {
  let registration;
  try {
    registration = assertRegisteredRelationship(
      edgeType as EdgeType,
      fromNodeType,
      toNodeType,
    );
  } catch {
    // Never throws — an unregistered `(edge_type, from, to)` is a denial,
    // not a Worker fault. In the real path a bad edge_type never reaches
    // here (`parseEdgeRecord` rejects it, the batch is `invalid`); this is
    // the standalone-call guard.
    return {
      allowed: false,
      reason: `${edgeType} (${fromNodeType} -> ${toNodeType}) is not a registered relationship`,
    };
  }
  for (const nodeType of [fromNodeType, toNodeType]) {
    const partitions = getProtectionPartitions(nodeType);
    let partitionKey: string;
    if (partitions.length === 1) {
      partitionKey = partitions[0]!.key;
    } else if (partitions.length > 1) {
      const declared = registration.governingPartitions[nodeType];
      if (declared === undefined || !partitions.some(({ key }) => key === declared)) {
        return {
          allowed: false,
          reason:
            `${edgeType}'s endpoint ${nodeType} has ${partitions.length} privacy partitions and ` +
            "the edge registry declares no governing partition for it; VPS-A004 does not define " +
            "which one governs an edge write, so this resolves conservatively to none (F136)",
        };
      }
      partitionKey = declared;
    } else {
      return {
        allowed: false,
        reason:
          `${edgeType}'s endpoint ${nodeType} has inherited protection with no concrete ` +
          "partition; resolves conservatively to none (F136)",
      };
    }
    const resolution = bestResolution(roles, nodeType, partitionKey);
    if (resolution.outcome !== "full") {
      return {
        allowed: false,
        reason: `No role in this caller's set resolves to Full (write) permission for ${edgeType}'s endpoint ${nodeType}/${partitionKey}`,
      };
    }
  }
  return GRANTED;
}

/**
 * FDN-85. Workspace and WorkspaceMembership are Better Auth control-plane
 * records; their local graph nodes, and the `membership_of` / `membership_in`
 * edges between them, are a deterministic one-way projection of that control
 * plane. They are written ONLY by FDN-85's privileged projection command — a
 * distinctly-named, single-use, server-signed path that is not this generic
 * `mutate` gate. Any generic mutation batch that adds, changes, or removes
 * one of them is refused `unsupported`, the same treatment a Movable Tree
 * change gets: a committable representation exists, but not through this
 * entrypoint. ("Prevent direct application writes to either representation",
 * FDN-85 Scope.)
 *
 * `User` is deliberately NOT reserved here — the projection command writes it
 * too, but as an idempotent upsert keyed by the shared account id, and other
 * legitimate paths may write a `User` fragment. Only the two control-plane
 * *representations* are locked to the projection command.
 */
const RESERVED_PROJECTION_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "Workspace",
  "WorkspaceMembership",
]);
const RESERVED_PROJECTION_EDGE_TYPES: ReadonlySet<string> = new Set([
  "membership_of",
  "membership_in",
]);
const RESERVED_AUDIT_NODE_TYPES: ReadonlySet<string> = new Set(["AuditEntry"]);

function reservedProjectionReason(what: string): string {
  return (
    `This batch changes ${what}, a Workspace/membership projection record. ` +
    "Those are written only by FDN-85's privileged projection command, never " +
    "through the generic mutation entrypoint (F132/FDN-85); refused rather " +
    "than committed."
  );
}

function reservedAuditReason(): string {
  return (
    "This batch changes an AuditEntry node fragment. AuditEntry is append-only " +
    "and is written only by the internal audit recorder; generic mutation " +
    "cannot create, alter, or remove one (F198/FDN-68)."
  );
}

/**
 * FDN-85. The first reserved Workspace/membership projection record this
 * batch would add, change, or remove — matched on the RAW `node_type` /
 * `edge_type` string, before any Zod parse, so a malformed projection record
 * cannot be used to probe past this refusal. Returns a describing phrase for
 * `reservedProjectionReason`, or `null` when the batch touches none.
 *
 * "Changed" is by canonical-JSON inequality per container key, exactly as
 * the node- and edge-fragment diffs are — an unchanged projection record
 * carried along in an unrelated batch is left alone.
 */
function firstReservedProjectionChange(
  beforeNodes: readonly NodeFragmentInput[],
  afterNodes: readonly NodeFragmentInput[],
  beforeEdges: readonly EdgeInput[],
  afterEdges: readonly EdgeInput[],
): string | null {
  const rawType = (
    record: unknown,
    field: "node_type" | "edge_type",
  ): string | null => {
    if (typeof record !== "object" || record === null) return null;
    const value = (record as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  };

  const scan = <T>(
    before: readonly T[],
    after: readonly T[],
    key: (item: T) => string,
    record: (item: T) => unknown,
    field: "node_type" | "edge_type",
    reserved: ReadonlySet<string>,
    describe: (type: string) => string,
  ): string | null => {
    const beforeByKey = new Map(before.map((item) => [key(item), item]));
    const afterByKey = new Map(after.map((item) => [key(item), item]));
    for (const k of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
      const b = beforeByKey.get(k);
      const a = afterByKey.get(k);
      const bJson = b === undefined ? null : canonicalJson(record(b) as JsonValue);
      const aJson = a === undefined ? null : canonicalJson(record(a) as JsonValue);
      if (bJson === aJson) continue;
      const type = rawType(record(a ?? b!), field) ?? rawType(record(b ?? a!), field);
      if (type !== null && reserved.has(type)) return describe(type);
    }
    return null;
  };

  return (
    scan(
      beforeNodes,
      afterNodes,
      (f) =>
        `${(f.record as Record<string, unknown>)?.["node_id"] as string} ${f.partitionKey}`,
      (f) => f.record,
      "node_type",
      RESERVED_PROJECTION_NODE_TYPES as ReadonlySet<string>,
      (type) => `a ${type} node fragment`,
    ) ??
    scan(
      beforeEdges,
      afterEdges,
      (e) => (e.record as Record<string, unknown>)?.["edge_id"] as string,
      (e) => e.record,
      "edge_type",
      RESERVED_PROJECTION_EDGE_TYPES,
      (type) => `a ${type} edge`,
    )
  );
}

/**
 * F198 / FDN-68 Stage 1. AuditEntry has a storage representation, but its
 * only ordinary writer is the dedicated audit recorder FDN-68 builds in a
 * later stage. Detect the raw type before Zod parsing and before
 * `authorizeNodeWrite`, so the policy table's intentional read grant cannot
 * fall through to generic Full=CRUD behavior. Added, changed, and removed
 * fragments are all reserved; an unchanged AuditEntry carried in a batch is
 * not treated as a mutation.
 */
function changesReservedAuditEntry(
  before: readonly NodeFragmentInput[],
  after: readonly NodeFragmentInput[],
): boolean {
  const beforeByKey = new Map(
    before.map((fragment) => [
      `${(fragment.record as Record<string, unknown>)?.["node_id"] as string}\u0000${fragment.partitionKey}`,
      fragment,
    ]),
  );
  const afterByKey = new Map(
    after.map((fragment) => [
      `${(fragment.record as Record<string, unknown>)?.["node_id"] as string}\u0000${fragment.partitionKey}`,
      fragment,
    ]),
  );

  for (const key of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
    const beforeFragment = beforeByKey.get(key);
    const afterFragment = afterByKey.get(key);
    const beforeJson =
      beforeFragment === undefined
        ? null
        : canonicalJson(beforeFragment.record as JsonValue);
    const afterJson =
      afterFragment === undefined
        ? null
        : canonicalJson(afterFragment.record as JsonValue);
    if (beforeJson === afterJson) continue;

    const rawNodeType = (record: unknown): string | null => {
      if (typeof record !== "object" || record === null) return null;
      const nodeType = (record as Record<string, unknown>)["node_type"];
      return typeof nodeType === "string" ? nodeType : null;
    };
    const beforeNodeType = rawNodeType(beforeFragment?.record);
    const afterNodeType = rawNodeType(afterFragment?.record);
    if (
      (beforeNodeType !== null && RESERVED_AUDIT_NODE_TYPES.has(beforeNodeType)) ||
      (afterNodeType !== null && RESERVED_AUDIT_NODE_TYPES.has(afterNodeType))
    ) {
      return true;
    }
  }
  return false;
}

export interface DiffedNodeFragment {
  readonly nodeId: string;
  readonly partitionKey: string;
  readonly nodeType: NodeType;
}

interface ParsedFragment {
  readonly fragment: NodeFragmentInput;
  readonly record: NodeRecord;
}

function fragmentKey(nodeId: string, partitionKey: string): string {
  return `${nodeId}\u0000${partitionKey}`;
}

function indexFragments(
  fragments: readonly NodeFragmentInput[],
): Map<string, ParsedFragment> {
  const index = new Map<string, ParsedFragment>();
  for (const fragment of fragments) {
    const record = parseNodeRecord(fragment.record);
    index.set(fragmentKey(record.node_id, fragment.partitionKey), { fragment, record });
  }
  return index;
}

/**
 * The fork-then-diff half of the mutation entrypoint (runtime.ts's
 * `mutate`): given the node-fragment container's contents before and after
 * a candidate delta batch is imported into a scratch fork, returns exactly
 * the `(node_id, partition_key)` fragments the batch would add, change, or
 * remove — added or changed by canonical-JSON inequality, removed by
 * presence in `before` and absence from `after`.
 *
 * Only THESE fragments are gated, never the whole document's fragments: a
 * batch that changes one Employee's operational partition must not be
 * required to hold Full write on every node type the workspace happens to
 * contain.
 */
export function diffChangedNodeFragments(
  before: readonly NodeFragmentInput[],
  after: readonly NodeFragmentInput[],
): DiffedNodeFragment[] {
  const beforeIndex = indexFragments(before);
  const afterIndex = indexFragments(after);
  const changed: DiffedNodeFragment[] = [];

  for (const key of new Set([...beforeIndex.keys(), ...afterIndex.keys()])) {
    const beforeEntry = beforeIndex.get(key);
    const afterEntry = afterIndex.get(key);
    const beforeCanonical = beforeEntry
      ? canonicalJson(beforeEntry.record as unknown as JsonValue)
      : null;
    const afterCanonical = afterEntry
      ? canonicalJson(afterEntry.record as unknown as JsonValue)
      : null;
    if (beforeCanonical === afterCanonical) continue;

    const winner = afterEntry ?? beforeEntry!;
    changed.push({
      nodeId: winner.record.node_id,
      partitionKey: winner.fragment.partitionKey,
      nodeType: winner.record.node_type,
    });
  }
  return changed;
}

export interface DiffedEdge {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

function indexEdges(
  edges: readonly EdgeInput[],
): Map<string, { readonly canonical: string; readonly record: EdgeRecord }> {
  const index = new Map<
    string,
    { readonly canonical: string; readonly record: EdgeRecord }
  >();
  for (const edge of edges) {
    const record = parseEdgeRecord(edge.record);
    index.set(record.edge_id, {
      canonical: canonicalJson(record as unknown as JsonValue),
      record,
    });
  }
  return index;
}

/**
 * FDN-92. The edge-fragment counterpart to `diffChangedNodeFragments`: given
 * `__vulto_edge_fragments`'s contents before and after a candidate batch is
 * imported into the scratch fork, returns exactly the edges the batch adds,
 * changes, or removes — added or changed by canonical-JSON inequality,
 * removed by presence in `before` and absence from `after`. Only these are
 * gated by `authorizeEdgeWrite`, never the whole document's edges.
 */
export function diffChangedEdgeFragments(
  before: readonly EdgeInput[],
  after: readonly EdgeInput[],
): DiffedEdge[] {
  const beforeIndex = indexEdges(before);
  const afterIndex = indexEdges(after);
  const changed: DiffedEdge[] = [];

  for (const key of new Set([...beforeIndex.keys(), ...afterIndex.keys()])) {
    const beforeEntry = beforeIndex.get(key);
    const afterEntry = afterIndex.get(key);
    if ((beforeEntry?.canonical ?? null) === (afterEntry?.canonical ?? null)) continue;

    const winner = (afterEntry ?? beforeEntry!).record;
    changed.push({
      edgeId: winner.edge_id,
      edgeType: winner.edge_type,
      fromNodeId: winner.from_node_id,
      toNodeId: winner.to_node_id,
    });
  }
  return changed;
}

export type MutationBatchOutcome =
  | { readonly status: "authorized" }
  | { readonly status: "denied"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "invalid"; readonly reason: string };

export interface MutationAuditEvidence {
  readonly operation: AuditOperation;
  readonly target: AuditTargetReference;
  readonly tier: DataTier;
  readonly decision: PermissionDecision;
}

/**
 * FDN-68's provenance-only view of a candidate batch. This does not decide
 * permission and does not alter authorizeMutationBatch's established public
 * outcomes; it describes the same before/after diff for the runtime's one
 * internal AuditRecorder after the existing decision has been made.
 */
export function describeMutationAuditEvidence(
  document: LoroDoc,
  deltas: readonly Uint8Array[],
  roles: readonly PolicyRole[],
): MutationAuditEvidence[] {
  const fork = document.fork();
  try {
    for (const delta of deltas) fork.import(delta);
    const before = indexFragments(readNodeFragments(document));
    const after = indexFragments(readNodeFragments(fork));
    const evidence: MutationAuditEvidence[] = [];
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const prior = before.get(key);
      const candidate = after.get(key);
      const priorJson = prior
        ? canonicalJson(prior.record as unknown as JsonValue)
        : null;
      const candidateJson = candidate
        ? canonicalJson(candidate.record as unknown as JsonValue)
        : null;
      if (priorJson === candidateJson) continue;
      const winner = candidate ?? prior!;
      const partition = getProtectionPartitions(winner.record.node_type).find(
        ({ key: partitionKey }) => partitionKey === winner.fragment.partitionKey,
      );
      if (partition === undefined) continue;
      evidence.push({
        operation:
          prior === undefined
            ? "NodeCreate"
            : candidate === undefined
              ? "NodeRemoveAttempt"
              : "NodeUpdate",
        target: {
          kind: "NodeTarget",
          node_type: winner.record.node_type,
          node_id: candidate?.record.node_id ?? null,
          partition_key: winner.fragment.partitionKey,
          target_tier: partition.tier,
        },
        tier: partition.tier,
        decision: resolvePermissionDecision(
          roles,
          winner.record.node_type,
          winner.fragment.partitionKey,
        ),
      });
    }

    const beforeEdges = indexEdges(readEdgeFragments(document));
    const afterEdges = indexEdges(readEdgeFragments(fork));
    const nodeTypeById = new Map<string, NodeType>();
    for (const fragment of [
      ...readNodeFragments(document),
      ...readNodeFragments(fork),
    ]) {
      const record = parseNodeRecord(fragment.record);
      nodeTypeById.set(record.node_id, record.node_type);
    }
    for (const key of new Set([...beforeEdges.keys(), ...afterEdges.keys()])) {
      const prior = beforeEdges.get(key);
      const candidate = afterEdges.get(key);
      if ((prior?.canonical ?? null) === (candidate?.canonical ?? null)) continue;
      const winner = (candidate ?? prior)!.record;
      const fromNodeType = nodeTypeById.get(winner.from_node_id);
      const toNodeType = nodeTypeById.get(winner.to_node_id);
      if (fromNodeType === undefined || toNodeType === undefined) continue;
      let registration;
      try {
        registration = assertRegisteredRelationship(
          winner.edge_type,
          fromNodeType,
          toNodeType,
        );
      } catch {
        continue;
      }
      const endpoint = (nodeType: NodeType) => {
        const partitions = getProtectionPartitions(nodeType);
        const partitionKey =
          partitions.length === 1
            ? partitions[0]!.key
            : registration.governingPartitions[nodeType];
        return partitionKey === undefined
          ? null
          : (partitions.find(
              ({ key: candidateKey }) => candidateKey === partitionKey,
            ) ?? null);
      };
      const from = endpoint(fromNodeType);
      const to = endpoint(toNodeType);
      if (from === null || to === null) continue;
      const fromDecision = resolvePermissionDecision(roles, fromNodeType, from.key);
      const toDecision = resolvePermissionDecision(roles, toNodeType, to.key);
      const rolesSnapshot = fromDecision.rolesSnapshot;
      // authorizeEdgeWrite resolves each endpoint independently over the role
      // union. Preserve that composition here: if different roles decide the
      // two endpoints, the canonical policy order supplies the one recorded
      // actor_role instead of incorrectly requiring one role to cover both.
      const decidingRole = POLICY_ROLES.find(
        (role) =>
          role === fromDecision.decidingRole || role === toDecision.decidingRole,
      );
      const authorized = authorizeEdgeWrite(
        winner.edge_type,
        fromNodeType,
        toNodeType,
        roles,
      ).allowed;
      const tier = Math.max(from.tier, to.tier) as DataTier;
      evidence.push({
        operation:
          prior === undefined
            ? "EdgeCreate"
            : candidate === undefined
              ? "EdgeRemoveAttempt"
              : "EdgeUpdate",
        target: {
          kind: "EdgeTarget",
          edge_type: winner.edge_type,
          edge_id: candidate?.record.edge_id ?? null,
          from_node_type: fromNodeType,
          to_node_type: toNodeType,
          target_tier: tier,
        },
        tier,
        decision: {
          outcome: authorized ? "full" : "none",
          decidingRole: authorized ? (decidingRole ?? null) : null,
          rolesSnapshot,
        },
      });
    }
    return evidence;
  } catch {
    return [];
  } finally {
    fork.free();
  }
}

/**
 * F138. The single refusal reason every coherence failure returns, verbatim.
 *
 * **Deliberately says nothing about WHY.** `validateGraphSnapshot`'s own
 * messages name node ids — and the fork it validates is the whole document
 * plus the candidate batch, so a failure can be caused by the interaction
 * between the batch and a node the caller was never permitted to read. Echoing
 * that message back would turn this refusal into an existence oracle: write a
 * fragment for a guessed node id, and a "conflicting node types" reply tells
 * you the id exists. That is exactly the leak `VPS-A004`'s denial rules
 * prohibit on the read path, and the same answer applies here — per F128's
 * standing rule, conservative is correct for anything ambiguous.
 *
 * The detail is not lost, it is just not returned across the boundary: the
 * underlying error stays in the Worker, where a developer can read it.
 */
export const INVALID_BATCH_REASON =
  "This batch would leave the workspace graph in a state the schema does not permit, and was refused before any change was applied.";

/**
 * The full simulate-then-diff-then-gate decision (`LocalGraphWorkerRuntime#mutate`
 * calls this, then commits only on `"authorized"`). Never mutates `document`
 * — the candidate batch is imported into a throwaway `document.fork()`,
 * compared against the real document's current state, and the fork is freed
 * before this returns either way.
 *
 * Checks, in order:
 *
 *   1. Every top-level container that differs between before and after,
 *      OTHER than the node-fragment and edge-fragment containers, refuses
 *      the whole batch as `unsupported` — the Movable Tree, the reserved
 *      document-meta container, or anything else a delta batch could in
 *      principle touch. Deliberately exhaustive rather than allow-listing
 *      "the Tree" by name: nothing this function does not explicitly
 *      recognize is permitted to slip through uninspected, the exact failure
 *      shape F131 exists to close.
 *   2. A changed fragment for a reserved Workspace/membership projection
 *      node type (`Workspace`, `WorkspaceMembership`), or a changed
 *      `membership_of` / `membership_in` edge, refuses the whole batch as
 *      `unsupported` (FDN-85): those are written only by FDN-85's privileged
 *      projection command, never this generic entrypoint.
 *   3. A changed AuditEntry fragment refuses the whole batch as
 *      `unsupported` (F198/FDN-68), before ordinary node-write dispatch.
 *   4. Within the node-fragment container, only the fragments this batch
 *      adds, changes, or removes are gated (`diffChangedNodeFragments` +
 *      `authorizeNodeWrite`) — never the whole document's fragments.
 *   5. Within the edge-fragment container (FDN-92), only the edges this
 *      batch adds, changes, or removes are gated (`diffChangedEdgeFragments`
 *      + `authorizeEdgeWrite`), the endpoint node types resolved from the
 *      fork's own materialized fragments.
 *   6. The fork is materialized and `validateGraphSnapshot`-checked whole
 *      (F138) — including the generic edges alongside `managed_by`'s
 *      Tree-derived ones — so an authorized-but-incoherent batch is refused
 *      (`invalid`) before any merge.
 *
 * A single denial at 4 or 5 refuses the whole batch; there is no partial
 * commit.
 */
export async function authorizeMutationBatch(
  document: LoroDoc,
  deltas: readonly Uint8Array[],
  roles: readonly PolicyRole[],
  workspaceId: string,
): Promise<MutationBatchOutcome> {
  const beforeDoc = document.toJSON() as Record<string, unknown>;
  const fork = document.fork();
  try {
    for (const delta of deltas) fork.import(delta);
    const afterDoc = fork.toJSON() as Record<string, unknown>;

    for (const key of new Set([...Object.keys(beforeDoc), ...Object.keys(afterDoc)])) {
      if (key === NODE_FRAGMENT_CONTAINER || key === EDGE_FRAGMENT_CONTAINER) continue;
      const beforeValue = canonicalJson((beforeDoc[key] ?? null) as JsonValue);
      const afterValue = canonicalJson((afterDoc[key] ?? null) as JsonValue);
      if (beforeValue !== afterValue) {
        return {
          status: "unsupported",
          reason:
            `This batch changes "${key}", which is neither the node-fragment ` +
            "nor the edge-fragment container. No committable storage convention " +
            "exists for the Movable Tree or other document state this stage " +
            "(F132/F134); refused rather than committed unchecked.",
        };
      }
    }

    // FDN-85. Workspace / WorkspaceMembership node fragments and
    // `membership_of` / `membership_in` edges are a one-way projection of the
    // Better Auth control plane, written only by FDN-85's privileged
    // projection command. A generic batch that touches one is refused
    // `unsupported` — a committable representation exists, just not here.
    const reservedProjection = firstReservedProjectionChange(
      readNodeFragments(document),
      readNodeFragments(fork),
      readEdgeFragments(document),
      readEdgeFragments(fork),
    );
    if (reservedProjection !== null) {
      return {
        status: "unsupported",
        reason: reservedProjectionReason(reservedProjection),
      };
    }

    // F198 / FDN-68 Stage 1. AuditEntry's Owner/HR Admin `full` policy is a
    // read grant for this exceptional immutable node type, not authority to
    // use the generic fragment writer. Keep this reservation ahead of
    // `authorizeNodeWrite`; FDN-68's internal append and actor-only
    // pseudonymization paths are separate and never dispatch through here.
    if (
      changesReservedAuditEntry(readNodeFragments(document), readNodeFragments(fork))
    ) {
      return { status: "unsupported", reason: reservedAuditReason() };
    }

    const changedNodes = diffChangedNodeFragments(
      readNodeFragments(document),
      readNodeFragments(fork),
    );
    for (const fragment of changedNodes) {
      const authorization = authorizeNodeWrite(
        fragment.nodeType,
        fragment.partitionKey,
        roles,
      );
      if (!authorization.allowed) {
        return { status: "denied", reason: authorization.reason };
      }
    }

    // FDN-92. Only the edges this batch adds, changes, or removes are gated,
    // each by `authorizeEdgeWrite` — the registry-declared governing
    // partition (never a value the delta supplies) resolves which partition
    // of a split endpoint governs. The endpoint node TYPES come from the
    // fork's own materialized node fragments (an endpoint the batch also
    // adds is already there); an edge whose endpoint is not materialized at
    // all is left for `validateGraphSnapshot` below to refuse as incoherent
    // (`invalid`), not denied here as a permission failure.
    const changedEdges = diffChangedEdgeFragments(
      readEdgeFragments(document),
      readEdgeFragments(fork),
    );
    if (changedEdges.length > 0) {
      const nodeTypeById = new Map<string, NodeType>();
      for (const fragment of readNodeFragments(fork)) {
        const record = parseNodeRecord(fragment.record);
        nodeTypeById.set(record.node_id, record.node_type);
      }
      for (const edge of changedEdges) {
        const fromNodeType = nodeTypeById.get(edge.fromNodeId);
        const toNodeType = nodeTypeById.get(edge.toNodeId);
        if (fromNodeType === undefined || toNodeType === undefined) continue;
        const authorization = authorizeEdgeWrite(
          edge.edgeType,
          fromNodeType,
          toNodeType,
          roles,
        );
        if (!authorization.allowed) {
          return { status: "denied", reason: authorization.reason };
        }
      }
    }

    // F138's fix, and the reason this function forks at all rather than
    // inspecting the deltas directly. Permission is only half the question:
    // `VPS-A004`'s Gate 1 asks whether this caller MAY write this node type
    // and partition, and nothing in it asks whether the resulting graph is
    // one the schema permits. Before this check existed, an authorized batch
    // whose fragments were individually permitted but collectively incoherent
    // — a foreign `workspace_id`, two partitions of one node disagreeing
    // about their own node type — passed the gate, merged into the canonical
    // document, and only THEN failed materialization, by which point the
    // merge was irreversible because a CRDT merge cannot be undone.
    //
    // Validating here, on the fork, is what makes the refusal free: the
    // canonical document is never touched, so a refused batch costs exactly
    // the simulation and nothing else. This mirrors `#materialize()` exactly
    // — same edge derivation, same snapshot validation, same workspace id —
    // so anything the real materializer would refuse is refused here first.
    // The second run inside `#commitDeltaBatch` then becomes an invariant
    // that should never fire rather than the place defects are discovered.
    const { edges: managedByEdges } = await materializeManagedByEdges(fork);
    validateGraphSnapshot(
      {
        nodeFragments: readNodeFragments(fork),
        edges: [...managedByEdges, ...readEdgeFragments(fork)],
      },
      workspaceId,
    );

    return { status: "authorized" };
  } catch {
    // Every operation above inspects UNTRUSTED candidate bytes: parsing a
    // record, deriving edges, validating the snapshot. A throw from any of
    // them is a statement about the batch, not about this Worker — so it is
    // reported as a refusal of that batch and never allowed to escape.
    //
    // This is what stops a malformed record from being a denial-of-service:
    // before the fix, `parseNodeRecord`'s raw `ZodError` propagated out of
    // `mutate`, `entry.ts` reported it as a FATAL `runtime-failure`, and the
    // client answered by terminating the Worker — after which every
    // subsequent call hung forever (F142). Failing closed here refuses one
    // batch instead of taking the graph layer down for the session.
    return { status: "invalid", reason: INVALID_BATCH_REASON };
  } finally {
    fork.free();
  }
}
