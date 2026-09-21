import type { LoroDoc } from "loro-crdt";
import type { EdgeInput } from "./materialization";

/**
 * FDN-92: where a generic edge record lives inside the workspace's Loro
 * document, and how the Worker reads it back out.
 *
 * FDN-50 stage 4 made `managed_by` a one-way materialization of the Movable
 * Tree (F104/F124), specifically so it never needs a stored representation.
 * `VPS-A002` registers ~90 other edge types — `has_skill`, `holds_certification`,
 * `assignment_of`, `membership_in`, and the rest — with a registry row and,
 * until now, nothing to write to (F132). This module is the missing storage
 * contract, the edge-record counterpart to `document-node-fragments.ts`'s
 * node-record contract.
 *
 * `VPS-A002` states that Loro stores properties as CRDT Maps and that schema
 * discipline lives in the TypeScript layer, not the storage layer. This
 * follows that literally, exactly as node fragments do: each edge is its OWN
 * nested `LoroMap`, so two devices editing different fields of the same edge
 * merge field by field. Storing an edge as one plain-object value would make
 * the whole edge a last-write-wins register, in which a concurrent
 * `effective_to` write silently discards a concurrent `metadata` edit.
 *
 * The key is the edge's own `edge_id` — a globally-unique UUID v4 — verbatim,
 * nothing composite. `VPS-A002`'s edge registry is keyed on the triple
 * `(edge_type, from_node_type, to_node_type)` (F61), and a storage key that
 * folded any of that in would collapse distinct relationships: `edge_type`
 * alone merges `governed_by`'s four registrations; `(edge_type, from_node_id)`
 * merges the two `governed_by` edges one `PayRun` legitimately holds; even
 * `(edge_type, from_node_id, to_node_id)` merges two edges with the same
 * endpoints but different ids and intervals (a re-opened `scoped_to_entity`,
 * a re-added `has_skill`). The triple is not lost — it is recovered per
 * instance at materialization from `(record.edge_type, type-of(from_node_id),
 * type-of(to_node_id))` and validated against the registry there, exactly as
 * `managed_by` already is.
 *
 * The container name and the source-id format below are durable on-disk
 * contract, in the same sense as stage 3's document-meta container, stage 4's
 * move-record keys, and stage 5's node-fragment container. Renaming either
 * makes every already-persisted document read as "this workspace has no
 * edges," which materializes as an empty edge set rather than as an error —
 * the least debuggable possible outcome. Treat them as frozen.
 */
export const EDGE_FRAGMENT_CONTAINER = "__vulto_edge_fragments";

/**
 * Refusal for an edge-fragment container whose contents do not match the
 * layout above. Every case here means something wrote the container without
 * going through this module's contract, and a silently skipped fragment
 * would present as an edge that simply does not exist. Fail loudly instead —
 * the same discipline `NodeFragmentLayoutError` applies to node fragments.
 */
export class EdgeFragmentLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeFragmentLayoutError";
  }
}

/**
 * An edge fragment's key is its `edge_id`, unchanged.
 *
 * There is nothing composite to build — an edge has exactly one fragment
 * (itself), unlike a node, whose split-protected partitions each materialize
 * as a fragment and so need `<node_id>:<partition_key>`. This function exists
 * for symmetry with `nodeFragmentKey` and to reject a value that cannot be a
 * key at all; the edge_id's UUID shape is the edge record schema's to
 * enforce, and `readEdgeFragments` cross-checks the key against the record.
 */
export function edgeFragmentKey(edgeId: string): string {
  if (typeof edgeId !== "string" || edgeId.length === 0) {
    throw new EdgeFragmentLayoutError("edgeId must be a non-empty string");
  }
  if (edgeId.trim() !== edgeId) {
    throw new EdgeFragmentLayoutError(
      `An edge fragment key may not carry surrounding whitespace: ${JSON.stringify(edgeId)}`,
    );
  }
  return edgeId;
}

/**
 * The `sourceDocumentId` a materialized edge fragment carries.
 *
 * Today one Loro document holds a whole workspace, so this is derived from
 * the fragment's own identity rather than read from anywhere — the same
 * position `nodeFragmentSourceDocumentId` takes, and for the same reason.
 * Shaped like stage 4's `movable-tree:<tree>:<employee>` and stage 5's
 * `node-fragment:<node>:<partition>` so all three materialized sources read
 * the same way in the index and `removeSourceDocumentIds` treats them
 * uniformly.
 */
export function edgeFragmentSourceDocumentId(edgeId: string): string {
  return `edge-fragment:${edgeId}`;
}

/**
 * Reads every edge fragment the document currently holds.
 *
 * Deterministic in the same strong sense stage 4's edge materialization and
 * stage 5's node-fragment read are: a pure function of the merged document,
 * returned in a stable key order, so two devices that have seen the same
 * operations produce identical edge lists regardless of merge order.
 *
 * `toJSON()` is used deliberately rather than walking containers by hand — it
 * resolves the nested per-edge `LoroMap` to plain JSON in one step, and reads
 * an edge written as a plain value identically, so this cannot silently
 * return a container handle in place of a record. The records themselves are
 * NOT validated here; `validateGraphSnapshot` parses every one against
 * `packages/schema`'s `edgeRecordSchema` before anything reaches SQLite, and
 * duplicating that would create a second, drifting definition of valid.
 */
export function readEdgeFragments(document: LoroDoc): readonly EdgeInput[] {
  const container = document.getMap(EDGE_FRAGMENT_CONTAINER).toJSON() as Record<
    string,
    unknown
  >;

  return Object.keys(container)
    .sort()
    .map((key) => {
      const edgeId = edgeFragmentKey(key);
      const record = container[key];
      if (typeof record !== "object" || record === null || Array.isArray(record)) {
        throw new EdgeFragmentLayoutError(`Edge fragment ${key} is not an object`);
      }
      const recordEdgeId = (record as Record<string, unknown>)["edge_id"];
      if (recordEdgeId !== edgeId) {
        throw new EdgeFragmentLayoutError(
          `Edge fragment ${key} carries edge_id ${String(recordEdgeId)}, which disagrees with its own key`,
        );
      }
      return {
        sourceDocumentId: edgeFragmentSourceDocumentId(edgeId),
        record,
      };
    });
}
