import type { LoroDoc, LoroTree, LoroTreeNode, OpId, PeerID, TreeID } from "loro-crdt";
import type { EdgeInput } from "./materialization";

/**
 * FDN-50 stage 4: the one-way materialization of the Loro Movable Tree's
 * resolved state into `managed_by` edges.
 *
 * The rule this file implements is `VPS-A002`'s single-active-outgoing
 * section and `VPS-A001`'s Movable Tree section, as corrected by F104 and
 * F124:
 *
 *   The Tree is the sole write target and the sole authority on who manages
 *   a person right now. The `managed_by` edge is a deterministic, one-way
 *   materialization of the Tree's resolved state, and is never written
 *   directly by any code path — not for convenience, and not for tests.
 *
 * F124 is the part that is easy to get wrong, because it separates two
 * facts that F104's original wording ran together:
 *
 *   1. WHICH concurrent move wins is a convergence question, answered by
 *      the Tree operation's causal ordering — specifically the pair
 *      `(lamport, peer)`. Lamport alone is NOT a total order. Reproduced
 *      against the pinned loro-crdt@1.14.1: two offline documents moving
 *      the same employee to different managers produce moves carrying the
 *      SAME Lamport value, and the peer identifier is what breaks the tie.
 *
 *   2. WHEN the winning move took effect is a real-world question, and it
 *      is NOT derivable from causal ordering at all. A Lamport counter is
 *      not a date. A Loro operation's `timestamp` is 0 unless timestamp
 *      recording is explicitly enabled, and once enabled it is the
 *      originating device's wall clock at one-second granularity —
 *      non-deterministic across devices and too coarse to separate two
 *      moves. The effective date is therefore CARRIED ON THE MOVE
 *      OPERATION ITSELF, as data on the Tree node, authored by whoever
 *      performed the move. It replicates with the operation, so every
 *      device reads an identical copy.
 *
 * Never use wall-clock time read at materialization, local arrival order,
 * or a Lamport counter as an interval value. Every timestamp this file
 * writes into an edge comes from data that replicated with the move.
 */

/**
 * The Movable Tree container holding the reporting hierarchy, and the keys
 * of the move record carried on each Tree node.
 *
 * These strings are durable on-disk contract, in the same sense as the
 * document-meta container FDN-50 stage 3 froze: renaming any of them makes
 * every already-persisted document read as "this employee has no dated
 * moves", which materializes as an empty history rather than as an error.
 * Treat them as frozen.
 */
export const ORG_HIERARCHY_TREE = "org_hierarchy";
export const EMPLOYEE_NODE_ID_KEY = "employee_node_id";
export const MOVE_RECORD_KEY_PREFIX = "move:";

/**
 * The data a move carries with it. Authored by the device performing the
 * move, in the same commit as the move operation, and keyed by that
 * operation's own OpId (see `moveRecordKey`).
 *
 * `manager_employee_node_id` is null for a move to a Tree root — an
 * employee with no manager. Such a move closes the prior edge and opens
 * nothing, which is a legitimate history and not an error.
 */
export interface TreeMoveRecord {
  readonly manager_employee_node_id: string | null;
  /** The real-world date the move takes effect. Becomes `effective_from`. */
  readonly effective_from: string;
  /**
   * The authoring device's wall clock at the moment the move was authored.
   * Deterministic across devices ONLY because it replicates with the
   * operation — this is a recorded value, never read from the local clock
   * at materialization time.
   */
  readonly recorded_at: string;
  /** The actor who performed the move. Becomes the edge's `created_by`. */
  readonly moved_by: string;
}

export interface MaterializedManagedByEdges {
  readonly edges: readonly EdgeInput[];
}

/**
 * Refusal for a move whose effective date does not move history forward.
 *
 * F125 is deliberately open: a backdated move — one whose effective date
 * precedes the currently active edge's `effective_from`, or falls inside a
 * closed historical interval — has no defined behavior, and FDN-50 stage 4
 * is scoped to forward-effective moves only. Silently accepting one would
 * produce overlapping or rewritten history, so it is refused here with a
 * message naming the finding rather than guessed at.
 */
export class BackdatedMoveNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackdatedMoveNotSupportedError";
  }
}

/**
 * Refusal for a Tree whose carried move data disagrees with the Tree's own
 * resolved state. The Tree is authoritative; if the winning move's recorded
 * manager is not the parent the Tree resolved to, something wrote the
 * record without the move (or the move without the record), and the
 * one-write guarantee F104 rests on has already been broken. Fail loudly.
 */
export class TreeMaterializationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreeMaterializationConflictError";
  }
}

interface DatedMove {
  readonly opId: OpId;
  readonly lamport: number;
  readonly peer: bigint;
  readonly record: TreeMoveRecord;
}

export function moveRecordKey(opId: OpId): string {
  return `${MOVE_RECORD_KEY_PREFIX}${opId.peer}:${opId.counter}`;
}

function parseMoveRecordKey(key: string): OpId | null {
  if (!key.startsWith(MOVE_RECORD_KEY_PREFIX)) return null;
  const rest = key.slice(MOVE_RECORD_KEY_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0) return null;
  const peer = rest.slice(0, separator);
  const counter = Number(rest.slice(separator + 1));
  if (!/^\d+$/.test(peer)) return null;
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  return { peer: peer as PeerID, counter };
}

/**
 * The Lamport value of a single operation.
 *
 * `getChangeAt` returns the CHANGE containing the operation, not the
 * operation, and a change is a run of consecutive operations sharing one
 * starting Lamport value. Verified against loro-crdt@1.14.1: a change with
 * `{ lamport: 0, counter: 0, length: 4 }` contains the op at counter 3,
 * whose own Lamport value is 3. Reading `change.lamport` directly would
 * report every operation in a change as having the change's first Lamport
 * value, which collapses distinct moves onto one ordering key.
 */
function operationLamport(document: LoroDoc, opId: OpId): number {
  const change = document.getChangeAt(opId);
  return change.lamport + (opId.counter - change.counter);
}

/**
 * The total order F124 names: Lamport first, peer as the tie-break.
 *
 * The peer is compared as a BigInt, never as a string. Peer identifiers are
 * u64 values rendered as decimal strings, and lexicographic string order
 * disagrees with numeric order as soon as they differ in length —
 * `["9", "10", "100"].sort()` yields `["10", "100", "9"]`. A string
 * comparison here would silently pick the wrong winner for some peer pairs
 * and agree with the Tree for others, which is worse than failing.
 */
function compareMoves(left: DatedMove, right: DatedMove): number {
  if (left.lamport !== right.lamport) return left.lamport - right.lamport;
  if (left.peer === right.peer) return 0;
  return left.peer < right.peer ? -1 : 1;
}

function sameOpId(left: OpId, right: OpId): boolean {
  return left.peer === right.peer && left.counter === right.counter;
}

/**
 * Concurrent-loser elimination.
 *
 * A move survives if and only if every move ordered after it is a causal
 * DESCENDANT of it. Read plainly: the move was, at some point, the answer
 * that everyone who moved later had actually seen. A move that is beaten by
 * a move it never saw — a concurrent one — was never the converged truth on
 * any device, and must not materialize as an interval at all.
 *
 * This is the rule F104 names ("the losing move never becomes a separately
 * materialized active period once the merge superseding it has been
 * observed") and F125 refers to as "concurrent-loser elimination". The
 * alternative — sequencing losers into history by total order — is wrong
 * twice over: it asserts a reporting line that never held on any converged
 * view, and when two concurrent moves carry the same effective date it
 * produces a zero-length interval that `edgeRecordSchema` rejects outright.
 *
 * `cmpFrontiers` returns `undefined` for genuinely concurrent operations
 * and -1/1 for causally ordered ones, which is exactly the distinction
 * between a concurrent loser and a legitimate predecessor.
 */
function survivingMoves(document: LoroDoc, moves: readonly DatedMove[]): DatedMove[] {
  return moves.filter((move) =>
    moves.every((other) => {
      if (sameOpId(move.opId, other.opId)) return true;
      if (compareMoves(other, move) <= 0) return true;
      // `other` is ordered after `move`. `move` survives only if `other`
      // descends from it; undefined means concurrent, so `move` loses.
      return document.cmpFrontiers([move.opId], [other.opId]) === -1;
    }),
  );
}

function asMoveRecord(value: unknown): TreeMoveRecord {
  if (typeof value !== "object" || value === null) {
    throw new TreeMaterializationConflictError("A move record must be an object");
  }
  const record = value as Record<string, unknown>;
  const manager = record[
    "manager_employee_node_id"
  ] as TreeMoveRecord["manager_employee_node_id"];
  const effectiveFrom = record["effective_from"];
  const recordedAt = record["recorded_at"];
  const movedBy = record["moved_by"];
  if (manager !== null && typeof manager !== "string") {
    throw new TreeMaterializationConflictError(
      "A move record's manager_employee_node_id must be a string or null",
    );
  }
  if (
    typeof effectiveFrom !== "string" ||
    typeof recordedAt !== "string" ||
    typeof movedBy !== "string"
  ) {
    throw new TreeMaterializationConflictError(
      "A move record must carry string effective_from, recorded_at and moved_by",
    );
  }
  return {
    manager_employee_node_id: manager,
    effective_from: effectiveFrom,
    recorded_at: recordedAt,
    moved_by: movedBy,
  };
}

function employeeNodeId(node: LoroTreeNode): string | null {
  const value = node.data.get(EMPLOYEE_NODE_ID_KEY);
  return typeof value === "string" ? value : null;
}

/**
 * A deterministic edge_id in UUID v4 SHAPE, derived from replicated data
 * only.
 *
 * `edgeRecordSchema` requires a v4 UUID, and every device must independently
 * compute the SAME identifier for the same materialized interval — otherwise
 * two devices' histories differ by edge_id even when they agree on target
 * and interval, and the edge stops being a one-way function of the Tree.
 * A random v4 cannot do that, so the identifier is a SHA-256 of the
 * employee's node id and the move's OpId, with the version and variant
 * nibbles forced to v4. Both inputs replicate with the document, so the
 * result is identical everywhere and stable across re-materialization.
 */
async function deterministicEdgeId(employeeId: string, opId: OpId): Promise<string> {
  const seed = `managed_by ${employeeId} ${opId.peer} ${opId.counter}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function collectDatedMoves(document: LoroDoc, node: LoroTreeNode): DatedMove[] {
  const moves: DatedMove[] = [];
  for (const key of node.data.keys()) {
    const opId = parseMoveRecordKey(key);
    if (opId === null) continue;
    moves.push({
      opId,
      lamport: operationLamport(document, opId),
      peer: BigInt(opId.peer),
      record: asMoveRecord(node.data.get(key)),
    });
  }
  return moves;
}

function assertForwardEffective(
  employeeId: string,
  ordered: readonly DatedMove[],
): void {
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (
      Date.parse(current.record.effective_from) <=
      Date.parse(previous.record.effective_from)
    ) {
      throw new BackdatedMoveNotSupportedError(
        `Employee ${employeeId} has a move effective ${current.record.effective_from} that does not follow ` +
          `the preceding move effective ${previous.record.effective_from}. Backdated and same-instant moves ` +
          `have no defined behavior and are refused rather than guessed at; recorded as F125.`,
      );
    }
  }
}

/**
 * Materializes the complete `managed_by` edge history for every employee in
 * the Tree.
 *
 * Deterministic in the strong sense the F104 proof requires: the result is a
 * pure function of the merged document, so two devices that have seen the
 * same operations produce byte-identical histories regardless of the order
 * in which they merged them.
 */
export async function materializeManagedByEdges(
  document: LoroDoc,
  treeName: string = ORG_HIERARCHY_TREE,
): Promise<MaterializedManagedByEdges> {
  const tree: LoroTree = document.getTree(treeName);
  const employeeIds = new Map<TreeID, string>();
  for (const node of tree.nodes()) {
    const id = employeeNodeId(node);
    if (id !== null) employeeIds.set(node.id, id);
  }

  const edges: EdgeInput[] = [];

  for (const node of tree.nodes()) {
    const employeeId = employeeIds.get(node.id);
    if (employeeId === undefined) continue;

    const moves = collectDatedMoves(document, node);
    const parent = node.parent();

    if (moves.length === 0) {
      // No dated move means no history to materialize. That is correct only
      // for a Tree root: a node that HAS a parent but no dated move was
      // placed there without an effective date, which cannot be
      // materialized into a half-open interval and must not be invented.
      if (parent !== undefined) {
        throw new TreeMaterializationConflictError(
          `Employee ${employeeId} has a Tree parent but no dated move record; ` +
            `every placement must carry its own effective date (F124)`,
        );
      }
      continue;
    }

    const ordered = survivingMoves(document, moves).sort(compareMoves);

    // The Tree is authoritative. The last surviving move must be the move
    // the Tree itself resolved to, and its recorded manager must be the
    // parent the Tree resolved to. If either disagrees, the edge is no
    // longer a one-way function of the Tree and the whole guarantee is void.
    const winner = ordered[ordered.length - 1]!;
    const treeWinner = node.getLastMoveId();
    if (treeWinner === undefined) {
      throw new TreeMaterializationConflictError(
        `Employee ${employeeId} carries dated move records but the Tree reports no move for it`,
      );
    }
    if (!sameOpId(winner.opId, treeWinner)) {
      throw new TreeMaterializationConflictError(
        `Employee ${employeeId}: the surviving move ${moveRecordKey(winner.opId)} is not the Tree's ` +
          `own resolved move ${moveRecordKey(treeWinner)}`,
      );
    }
    const resolvedManagerId =
      parent === undefined ? null : (employeeIds.get(parent.id) ?? null);
    if (winner.record.manager_employee_node_id !== resolvedManagerId) {
      throw new TreeMaterializationConflictError(
        `Employee ${employeeId}: the winning move records manager ` +
          `${String(winner.record.manager_employee_node_id)} but the Tree resolved to ` +
          `${String(resolvedManagerId)}`,
      );
    }

    assertForwardEffective(employeeId, ordered);

    for (let index = 0; index < ordered.length; index += 1) {
      const move = ordered[index]!;
      const managerId = move.record.manager_employee_node_id;
      // A move to a Tree root records "no manager from this date". It closes
      // the preceding interval by being the next boundary and opens nothing.
      if (managerId === null) continue;
      const next = ordered[index + 1];
      edges.push({
        sourceDocumentId: `movable-tree:${treeName}:${employeeId}`,
        record: {
          edge_id: await deterministicEdgeId(employeeId, move.opId),
          edge_type: "managed_by",
          from_node_id: employeeId,
          to_node_id: managerId,
          effective_from: move.record.effective_from,
          effective_to: next === undefined ? null : next.record.effective_from,
          created_at: move.record.recorded_at,
          created_by: move.record.moved_by,
          metadata: {
            materialized_from: "movable-tree",
            move_op: `${move.opId.counter}@${move.opId.peer}`,
          },
          is_soft_deleted: false,
          soft_deleted_at: null,
          soft_deleted_by: null,
        },
      });
    }
  }

  edges.sort((left, right) => {
    const leftRecord = left.record as { from_node_id: string; effective_from: string };
    const rightRecord = right.record as {
      from_node_id: string;
      effective_from: string;
    };
    if (leftRecord.from_node_id !== rightRecord.from_node_id) {
      return leftRecord.from_node_id < rightRecord.from_node_id ? -1 : 1;
    }
    return (
      Date.parse(leftRecord.effective_from) - Date.parse(rightRecord.effective_from)
    );
  });

  return { edges };
}

export interface TreeMoveInput {
  readonly employeeNodeId: string;
  readonly effectiveFrom: string;
  readonly recordedAt: string;
  readonly movedBy: string;
}

/**
 * Performs a Movable Tree move and stamps the move's own effective date
 * onto it, atomically from the document's point of view.
 *
 * This is the ONLY way a `managed_by` relationship changes. There is no
 * corresponding edge-writing function anywhere, deliberately.
 *
 * The record is keyed by the move operation's OpId, which is why concurrent
 * moves cannot clobber each other's dates: two devices moving the same
 * employee write to two DIFFERENT keys, because an OpId contains the
 * authoring peer. A single shared key such as `effective_from` would be a
 * last-write-wins register, and its winner is resolved by the map's own
 * rules rather than the Tree's — so the surviving date could belong to the
 * losing move. Verified against loro-crdt@1.14.1: after merging two
 * concurrent moves, BOTH op-keyed records are present and identical in
 * either merge order.
 */
export function applyTreeMove(
  node: LoroTreeNode,
  parent: LoroTreeNode | undefined,
  move: TreeMoveInput,
): OpId {
  if (parent === undefined) node.move();
  else node.move(parent);
  const opId = node.getLastMoveId();
  if (opId === undefined) {
    throw new TreeMaterializationConflictError(
      "The Tree reported no move operation for a move that was just performed",
    );
  }
  const record: TreeMoveRecord = {
    manager_employee_node_id:
      parent === undefined ? null : (employeeNodeId(parent) ?? null),
    effective_from: move.effectiveFrom,
    recorded_at: move.recordedAt,
    moved_by: move.movedBy,
  };
  node.data.set(moveRecordKey(opId), { ...record });
  return opId;
}

/**
 * Creates a Tree node for an employee and records its initial placement as
 * a dated move, so the first reporting line is materialized on exactly the
 * same path as every later one. A node created without a parent is a Tree
 * root and carries no move record at all — it has no manager, so there is
 * no interval to open.
 */
export function createEmployeeTreeNode(
  tree: LoroTree,
  employeeNodeId_: string,
  parent: LoroTreeNode | undefined,
  move: Omit<TreeMoveInput, "employeeNodeId"> | undefined,
): LoroTreeNode {
  const node = tree.createNode();
  node.data.set(EMPLOYEE_NODE_ID_KEY, employeeNodeId_);
  if (parent === undefined || move === undefined) return node;
  applyTreeMove(node, parent, { employeeNodeId: employeeNodeId_, ...move });
  return node;
}
