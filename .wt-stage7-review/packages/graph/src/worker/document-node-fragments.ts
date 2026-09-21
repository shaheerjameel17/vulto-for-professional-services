import type { LoroDoc } from "loro-crdt";
import type { NodeFragmentInput } from "./materialization";

/**
 * FDN-50 stage 5: where a node's own record lives inside the workspace's
 * Loro document, and how the Worker reads it back out.
 *
 * Stage 4 made the `managed_by` edge a one-way materialization of the
 * Movable Tree. Connecting that to the SQLite index surfaced a fact no
 * earlier stage had to confront: `materialization.ts` refuses an edge whose
 * endpoints are not themselves materialized —
 *
 *   Edge <id> references an endpoint absent from the local materialization
 *
 * — and nothing in this repository produced a node fragment from a Loro
 * document. The Tree carries employee IDENTIFIERS, not employee RECORDS, so
 * the Tree alone can never satisfy that check. Manufacturing a placeholder
 * Employee record from a Tree node was considered and rejected: `VPS-A003`
 * states the query layer never manufactures received instance data, and a
 * synthesized record is exactly that.
 *
 * So this module defines the missing half of the canonical document layout
 * FDN-50 owns — the node-record side, alongside stage 4's Tree side.
 *
 * `VPS-A002` states that Loro stores node properties as CRDT Maps and that
 * schema discipline lives in the TypeScript layer rather than the storage
 * layer. This follows that literally: each fragment is its OWN nested
 * `LoroMap`, so two devices editing different fields of the same fragment
 * merge field by field. Storing the record as one plain-object value would
 * have made the whole fragment a last-write-wins register, in which a
 * concurrent edit to a person's job title silently discards a concurrent
 * edit to their location. That is a storage-layout decision, not a
 * preference, and it is far cheaper to make correctly now than to migrate
 * later.
 *
 * The container name and the key format below are durable on-disk contract,
 * in exactly the sense stage 3's document-meta container and stage 4's move
 * record keys are. Renaming either makes every already-persisted document
 * read as "this workspace has no nodes," which materializes as an empty
 * index rather than as an error. Treat them as frozen.
 */
export const NODE_FRAGMENT_CONTAINER = "__vulto_node_fragments";

/**
 * A fragment's key is `<node_id>:<partition_key>`.
 *
 * A node type with split protection — Employee is the canonical case, whose
 * operational fields are Tier 0 and whose compensation fields are Tier 1 —
 * materializes as several fragments of ONE node, so the node id alone
 * cannot key them. Node ids are UUIDs and partition keys are bare
 * identifiers (`operational`, `compensation`, `record`), so neither half
 * ever contains the separator.
 */
export const NODE_FRAGMENT_KEY_SEPARATOR = ":";

/**
 * Refusal for a fragment container whose contents do not match the layout
 * above. Every case here means something wrote the container without going
 * through this module's key format, and a silently skipped fragment would
 * present as a node that simply does not exist — the least debuggable
 * possible outcome. Fail loudly instead.
 */
export class NodeFragmentLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeFragmentLayoutError";
  }
}

export function nodeFragmentKey(nodeId: string, partitionKey: string): string {
  if (nodeId.length === 0)
    throw new NodeFragmentLayoutError("nodeId must not be empty");
  if (partitionKey.length === 0) {
    throw new NodeFragmentLayoutError("partitionKey must not be empty");
  }
  if (
    nodeId.includes(NODE_FRAGMENT_KEY_SEPARATOR) ||
    partitionKey.includes(NODE_FRAGMENT_KEY_SEPARATOR)
  ) {
    throw new NodeFragmentLayoutError(
      `A node fragment key may not contain "${NODE_FRAGMENT_KEY_SEPARATOR}": ${nodeId}/${partitionKey}`,
    );
  }
  return `${nodeId}${NODE_FRAGMENT_KEY_SEPARATOR}${partitionKey}`;
}

/**
 * The `sourceDocumentId` a materialized fragment carries.
 *
 * Today one Loro document holds a whole workspace, so this is derived from
 * the fragment's own identity rather than read from anywhere. FDN-52 owns
 * privacy-tier partitioning, at which point a fragment's source genuinely
 * becomes the tier document it arrived in and this function is where that
 * changes. Shaped like stage 4's `movable-tree:<tree>:<employee>` so the
 * two materialized sources read the same way in the index.
 */
export function nodeFragmentSourceDocumentId(
  nodeId: string,
  partitionKey: string,
): string {
  return `node-fragment:${nodeId}${NODE_FRAGMENT_KEY_SEPARATOR}${partitionKey}`;
}

function parseNodeFragmentKey(key: string): {
  nodeId: string;
  partitionKey: string;
} {
  const separator = key.lastIndexOf(NODE_FRAGMENT_KEY_SEPARATOR);
  if (separator <= 0 || separator === key.length - 1) {
    throw new NodeFragmentLayoutError(
      `Node fragment key ${key} is not <node_id>${NODE_FRAGMENT_KEY_SEPARATOR}<partition_key>`,
    );
  }
  return {
    nodeId: key.slice(0, separator),
    partitionKey: key.slice(separator + 1),
  };
}

/**
 * Reads every node fragment the document currently holds.
 *
 * Deterministic in the same strong sense stage 4's edge materialization is:
 * a pure function of the merged document, returned in a stable key order,
 * so two devices that have seen the same operations produce identical
 * fragment lists regardless of the order they merged them in.
 *
 * `toJSON()` is used deliberately rather than walking containers by hand —
 * it resolves the nested per-fragment `LoroMap` to plain JSON in one step,
 * and reads a fragment written as a plain value identically, so this cannot
 * silently return a container handle in place of a record. The records
 * themselves are NOT validated here; `validateGraphSnapshot` parses every
 * one of them against `packages/schema` before anything reaches SQLite,
 * and duplicating that would create a second, drifting definition of valid.
 */
export function readNodeFragments(document: LoroDoc): readonly NodeFragmentInput[] {
  const container = document.getMap(NODE_FRAGMENT_CONTAINER).toJSON() as Record<
    string,
    unknown
  >;

  return Object.keys(container)
    .sort()
    .map((key) => {
      const { nodeId, partitionKey } = parseNodeFragmentKey(key);
      const record = container[key];
      if (typeof record !== "object" || record === null || Array.isArray(record)) {
        throw new NodeFragmentLayoutError(`Node fragment ${key} is not an object`);
      }
      const recordNodeId = (record as Record<string, unknown>)["node_id"];
      if (recordNodeId !== nodeId) {
        throw new NodeFragmentLayoutError(
          `Node fragment ${key} carries node_id ${String(recordNodeId)}, which disagrees with its own key`,
        );
      }
      return {
        sourceDocumentId: nodeFragmentSourceDocumentId(nodeId, partitionKey),
        partitionKey,
        record,
      };
    });
}
