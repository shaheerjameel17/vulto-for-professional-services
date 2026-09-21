/**
 * The DOCUMENT-level schema generation, per FDN-50 stage 3's Decision 3.
 *
 * This is a different fact from the per-record `schema_version` that
 * `VPS-A002`'s Schema Evolution Protocol point 5 defines and that
 * `records.ts` validates. The two answer different questions and must not be
 * conflated:
 *
 *  - `schema_version` is per node type, per record. It lets a client reason
 *    about the shape of one record it is holding. Under A002-T07 an older
 *    client MUST tolerate an unrecognized property on such a record rather
 *    than failing — that record-level tolerance is F102's work and is
 *    unchanged by anything here.
 *
 *  - The generation below is per DOCUMENT, recorded once at the root of the
 *    workspace's Loro document. It answers "was this whole document last
 *    written by a client whose graph contracts this build can still honor?"
 *    Record-level tolerance cannot answer that: tolerating each unknown
 *    property individually is exactly the behavior that would let an older
 *    client open a document a newer client restructured and silently
 *    materialize a partial, wrong view of it.
 *
 * The gate that reads this lives in `packages/graph`
 * (`worker/document-schema-gate.ts`); the number itself lives here because
 * `packages/schema` is the Schema Evolution Protocol's stated enforcement
 * point, and a generation maintained anywhere else would be a second,
 * competing answer to what generation the schema is at.
 *
 * WHEN TO INCREMENT: a change to the graph contracts that an older client
 * cannot safely read the document under — a restructuring, a change in how
 * an existing property is interpreted, anything that is not purely additive.
 * A purely additive change (a new node type, a new property) does NOT
 * increment it: additive is precisely what A002-T04 guarantees and A002-T07
 * requires older clients to tolerate.
 */

/** The generation this build writes into every document it persists. */
export const GRAPH_DOCUMENT_SCHEMA_GENERATION = 1;

/**
 * The oldest generation this build can still read. Together with
 * GRAPH_DOCUMENT_SCHEMA_GENERATION this forms the closed compatible range
 * [minimum, current].
 *
 * It is a separate constant rather than a hardcoded 1 so that dropping
 * support for a superseded generation is a one-line, reviewable change
 * rather than a rewrite of the gate. Today both ends are 1, so the only
 * reachable refusal is a document written by a NEWER client — which is the
 * case Decision 3 exists for.
 */
export const MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION = 1;

/** True when this build can read a document recorded at `generation`. */
export function isReadableGraphDocumentSchemaGeneration(generation: number): boolean {
  return (
    Number.isInteger(generation) &&
    generation >= MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION &&
    generation <= GRAPH_DOCUMENT_SCHEMA_GENERATION
  );
}
