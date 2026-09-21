import {
  GRAPH_DOCUMENT_SCHEMA_GENERATION,
  MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
  isReadableGraphDocumentSchemaGeneration,
} from "@vulto/schema";

/**
 * FDN-50 stage 3: the DOCUMENT-level schema-version gate (Decision 3).
 *
 * WHERE THE GENERATION LIVES, AND WHY THERE
 *
 * The whole point of this value is that it must be readable in exactly the
 * situation where the rest of the document may not be understandable — a
 * document a newer client restructured. Reading it therefore must not
 * require first trusting any schema-shaped structure that could itself have
 * changed between generations.
 *
 * So it lives in its own reserved root container, holding one scalar under
 * one key, and nothing else — ever. Loro addresses root containers by name
 * and type (`cid:root-<name>:Map`), so this container is reachable by name
 * directly off the imported document, without walking into node fragments,
 * edge records, the Movable Tree, or anything else a future generation might
 * restructure. It is not a node, not an edge, and is deliberately outside
 * `VPS-A002`'s registry: it describes the document, not anything in it.
 *
 * THE TWO NAMES BELOW ARE FROZEN. They are durable on-disk contract, not
 * implementation detail. Renaming either one makes every already-persisted
 * document read as "no generation recorded," which is precisely the reading
 * that must never be produced by accident — see the "absent" case below.
 *
 * HOW THIS DIFFERS FROM A002-T07's RECORD-LEVEL TOLERANCE
 *
 * A002-T07 is a hard requirement that an older client ignore an
 * unrecognized property on a record rather than failing, and F102 already
 * built it (materialization.ts, via the record schemas' JSON-native
 * passthrough). That guarantee is about ONE RECORD carrying one more field
 * than this build knows about, and it stays exactly as it is: this gate does
 * not touch, weaken, or duplicate it.
 *
 * This gate is about THE WHOLE DOCUMENT having been last written under
 * contracts this build does not have. Record-level tolerance is the wrong
 * instrument for that and is actively dangerous there: tolerating each
 * unknown property one at a time is how an older client would quietly
 * materialize a partial, wrong view of a document it cannot actually read.
 * Within the compatible range the gate stands aside entirely and A002-T07's
 * behavior is what runs; outside it, the document is refused whole.
 */
export const GRAPH_DOCUMENT_META_CONTAINER = "__vulto_document_meta";
export const GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY = "schema_generation";

/**
 * Refusal to open a document written under a schema generation this build
 * cannot read.
 *
 * Deliberately distinct from every sealed-store failure and from a generic
 * "not initialized". None of those describe this condition:
 *  - SealedStoreLockedError        — no unlock has happened yet
 *  - SealedStoreCannotOpenError    — AES-GCM authentication failed
 *  - SealedStoreEnvelopeMismatchError — wrong workspace or key epoch
 * Here the store unlocked, the bytes decrypted and authenticated correctly,
 * and the document imported. It is simply not a document this build is
 * entitled to interpret. Collapsing it into any of the above would tell the
 * layer above to do the wrong thing (re-unlock, re-key, or re-sync), none of
 * which can help.
 *
 * `VPS-D004` has no render for this condition; that gap is logged as F120,
 * deliberately deferred, and is not this stage's work. This error is the
 * signal, not the presentation.
 */
export class UnsupportedDocumentSchemaGenerationError extends Error {
  readonly recordedGeneration: number | null;
  readonly minimumReadableGeneration: number;
  readonly currentGeneration: number;

  constructor(recordedGeneration: number | null) {
    super(
      `This document was written under schema generation ${
        recordedGeneration === null ? "an unreadable value" : String(recordedGeneration)
      }, outside this client's readable range ${MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION}-${GRAPH_DOCUMENT_SCHEMA_GENERATION}`,
    );
    this.recordedGeneration = recordedGeneration;
    this.minimumReadableGeneration = MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION;
    this.currentGeneration = GRAPH_DOCUMENT_SCHEMA_GENERATION;
  }
}

/**
 * Structural, not `LoroDoc`, so the gate's own decision table is unit
 * testable without a WASM instance. The runtime passes a real LoroDoc.
 */
export interface DocumentMetaReadable {
  getMap(name: string): { get(key: string): unknown };
}

export interface DocumentMetaWritable extends DocumentMetaReadable {
  getMap(name: string): {
    get(key: string): unknown;
    set(key: string, value: number): void;
  };
  commit(): void;
}

export type DocumentSchemaGenerationReading =
  /** Nothing recorded. A brand-new document, or one written before this gate existed. */
  | { readonly kind: "absent" }
  | { readonly kind: "recorded"; readonly generation: number }
  /** Present but not a positive integer — a marker this build cannot interpret. */
  | { readonly kind: "unreadable"; readonly raw: unknown };

export function readDocumentSchemaGeneration(
  document: DocumentMetaReadable,
): DocumentSchemaGenerationReading {
  let raw: unknown;
  try {
    raw = document
      .getMap(GRAPH_DOCUMENT_META_CONTAINER)
      .get(GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY);
  } catch (error: unknown) {
    // Reaching the reserved container itself failed. Whatever that document
    // is, this build cannot establish what generation it was written under,
    // and "cannot establish" is never allowed to read as "compatible."
    return { kind: "unreadable", raw: error };
  }
  if (raw === undefined || raw === null) return { kind: "absent" };
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return { kind: "recorded", generation: raw };
  }
  return { kind: "unreadable", raw };
}

/**
 * The gate. Throws UnsupportedDocumentSchemaGenerationError, or returns.
 *
 * The `absent` case proceeds, and that is a deliberate decision rather than
 * an oversight. A document with no recorded generation is one written before
 * this gate shipped, and by A002-T04 the schema evolves additively only —
 * so a NEWER client reading an OLDER document is exactly the direction the
 * protocol guarantees is safe, and is not what Decision 3 refuses. The
 * direction Decision 3 refuses is the opposite one: an older client opening
 * a document a newer client already wrote. Such a document always carries a
 * generation, because the client that wrote it stamped one.
 *
 * `unreadable` fails closed, because a marker this build cannot interpret is
 * not evidence of compatibility.
 */
export function assertDocumentSchemaGenerationReadable(
  document: DocumentMetaReadable,
): void {
  const reading = readDocumentSchemaGeneration(document);
  if (reading.kind === "absent") return;
  if (reading.kind === "unreadable") {
    throw new UnsupportedDocumentSchemaGenerationError(null);
  }
  if (!isReadableGraphDocumentSchemaGeneration(reading.generation)) {
    throw new UnsupportedDocumentSchemaGenerationError(reading.generation);
  }
}

/**
 * Records this build's generation on the document, immediately before it is
 * exported for a durable write — so a brand-new workspace's FIRST persist is
 * what stamps it, and a workspace that never mutates never writes anything
 * at all.
 *
 * It NEVER lowers a generation already recorded. A document carrying a
 * generation higher than this build's got there by merging a delta authored
 * by a newer client; stamping this build's own lower number over it would
 * erase the very marker that stops this build from misreading that document
 * on the next reopen. A generation this build cannot interpret is likewise
 * left exactly as found, for the same reason.
 */
export function stampDocumentSchemaGeneration(document: DocumentMetaWritable): void {
  const reading = readDocumentSchemaGeneration(document);
  if (reading.kind === "unreadable") return;
  if (
    reading.kind === "recorded" &&
    reading.generation >= GRAPH_DOCUMENT_SCHEMA_GENERATION
  ) {
    return;
  }
  document
    .getMap(GRAPH_DOCUMENT_META_CONTAINER)
    .set(GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY, GRAPH_DOCUMENT_SCHEMA_GENERATION);
  document.commit();
}
