import {
  getProtectionPartitions,
  parseNodeRecord,
  type JsonValue,
  type NodeRecord,
  type NodeType,
} from "@vulto/schema";
import type { LoroDoc } from "loro-crdt";
import { NODE_FRAGMENT_CONTAINER, readNodeFragments } from "../document-node-fragments";
import type { NodeFragmentInput } from "../materialization";
import { canonicalJson } from "../storage/canonical-json";
import { bestResolution } from "./interceptor";
import type { PolicyRole } from "./policy-table";

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
 * Gate 1 for an edge write, standalone and exhaustively tested (F132) but
 * never wired to a commit path — no edge type but `managed_by` has
 * committable CRDT storage, and stage 2 does not invent one (F132, open).
 *
 * `VPS-A004` assigns no Privacy Class or write-permission column to an edge
 * TYPE, only to node types and node-type partitions — the same gap the read
 * path's `interceptedEdgeNeighbors` already documents for Read. The
 * approximation used here: an edge write requires Full write permission on
 * BOTH endpoint node types. Where an endpoint node type has more than one
 * registered privacy partition (e.g. Employee's operational/compensation
 * split), which partition governs an edge write is genuinely undefined by
 * the spec — resolved conservatively to `none`, the same default direction
 * F128 already established for every other unresolvable case, rather than
 * guessing which partition applies. Recorded as F136.
 */
export function authorizeEdgeWrite(
  edgeType: string,
  fromNodeType: NodeType,
  toNodeType: NodeType,
  roles: readonly PolicyRole[],
): MutationAuthorization {
  for (const nodeType of [fromNodeType, toNodeType]) {
    const partitions = getProtectionPartitions(nodeType);
    if (partitions.length !== 1) {
      return {
        allowed: false,
        reason:
          `${edgeType}'s endpoint ${nodeType} has ${partitions.length} registered ` +
          "privacy partitions; VPS-A004 does not define which one governs an edge " +
          "write, so this resolves conservatively to none (F136)",
      };
    }
    const resolution = bestResolution(roles, nodeType, partitions[0]!.key);
    if (resolution.outcome !== "full") {
      return {
        allowed: false,
        reason: `No role in this caller's set resolves to Full (write) permission for ${edgeType}'s endpoint ${nodeType}`,
      };
    }
  }
  return GRANTED;
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

export type MutationBatchOutcome =
  | { readonly status: "authorized" }
  | { readonly status: "denied"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string };

/**
 * The full simulate-then-diff-then-gate decision (`LocalGraphWorkerRuntime#mutate`
 * calls this, then commits only on `"authorized"`). Never mutates `document`
 * — the candidate batch is imported into a throwaway `document.fork()`,
 * compared against the real document's current state, and the fork is freed
 * before this returns either way.
 *
 * Two checks, in order:
 *
 *   1. Every top-level container that differs between before and after,
 *      OTHER than the node-fragment container, refuses the whole batch as
 *      `unsupported` — the Movable Tree, the reserved document-meta
 *      container, or anything else a delta batch could in principle touch.
 *      Deliberately exhaustive rather than allow-listing "the Tree" by
 *      name: nothing this function does not explicitly recognize is
 *      permitted to slip through uninspected, which is the exact failure
 *      shape F131 exists to close. Edge-shaped state specifically has no
 *      committable storage convention this stage (F132, F134) —
 *      `authorizeEdgeWrite` proves the write-permission logic correct in
 *      isolation, but nothing here ever reaches it.
 *   2. Within the node-fragment container, only the fragments this batch
 *      actually adds, changes, or removes are gated (`diffChangedNodeFragments`
 *      + `authorizeNodeWrite`) — never the whole document's fragments. A
 *      single denial refuses the whole batch; there is no partial commit.
 */
export async function authorizeMutationBatch(
  document: LoroDoc,
  deltas: readonly Uint8Array[],
  roles: readonly PolicyRole[],
): Promise<MutationBatchOutcome> {
  const beforeDoc = document.toJSON() as Record<string, unknown>;
  const fork = document.fork();
  try {
    for (const delta of deltas) fork.import(delta);
    const afterDoc = fork.toJSON() as Record<string, unknown>;

    for (const key of new Set([...Object.keys(beforeDoc), ...Object.keys(afterDoc)])) {
      if (key === NODE_FRAGMENT_CONTAINER) continue;
      const beforeValue = canonicalJson((beforeDoc[key] ?? null) as JsonValue);
      const afterValue = canonicalJson((afterDoc[key] ?? null) as JsonValue);
      if (beforeValue !== afterValue) {
        return {
          status: "unsupported",
          reason:
            `This batch changes "${key}", which is not the node-fragment ` +
            "container. No committable storage convention exists for edge " +
            "or other document state this stage (F132/F134); refused rather " +
            "than committed unchecked.",
        };
      }
    }

    const changed = diffChangedNodeFragments(
      readNodeFragments(document),
      readNodeFragments(fork),
    );
    for (const fragment of changed) {
      const authorization = authorizeNodeWrite(
        fragment.nodeType,
        fragment.partitionKey,
        roles,
      );
      if (!authorization.allowed) {
        return { status: "denied", reason: authorization.reason };
      }
    }
    return { status: "authorized" };
  } finally {
    fork.free();
  }
}
