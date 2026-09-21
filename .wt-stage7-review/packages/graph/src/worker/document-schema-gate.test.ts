import {
  GRAPH_DOCUMENT_SCHEMA_GENERATION,
  MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
  isReadableGraphDocumentSchemaGeneration,
} from "@vulto/schema";
import { describe, expect, it } from "vitest";
import {
  GRAPH_DOCUMENT_META_CONTAINER,
  GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY,
  UnsupportedDocumentSchemaGenerationError,
  assertDocumentSchemaGenerationReadable,
  readDocumentSchemaGeneration,
  stampDocumentSchemaGeneration,
} from "./document-schema-gate";
import { validateGraphSnapshot, type NodeFragmentInput } from "./materialization";

/**
 * FDN-50 stage 3: the document-level schema-version gate's decision table.
 *
 * Driven entirely through the DocumentMetaReadable/DocumentMetaWritable
 * structural interfaces, which exist precisely so this table is provable
 * without a WASM instance. The gate running against a real LoroDoc, a real
 * SealedStore and a real Worker is proved separately, in
 * services/api/browser-tests-device-store/graph-schema-generation.spec.ts.
 */

interface FakeDocument {
  readonly document: {
    getMap(name: string): {
      get(key: string): unknown;
      set(key: string, value: number): void;
    };
    commit(): void;
  };
  /** What the reserved container holds right now, as the fake sees it. */
  current(): unknown;
  /** Container names the gate actually reached for. */
  readonly touchedContainers: string[];
  readonly setCalls: { key: string; value: number }[];
  commitCount(): number;
}

/**
 * A minimal stand-in for a LoroDoc's root-map addressing. Records every
 * write and commit so a "no-op" claim below is proved by the absence of a
 * write, not merely by the value happening to look unchanged afterward.
 */
function fakeDocument(initial: { present: boolean; value?: unknown }): FakeDocument {
  const containers = new Map<string, Map<string, unknown>>();
  const meta = new Map<string, unknown>();
  if (initial.present) meta.set(GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY, initial.value);
  containers.set(GRAPH_DOCUMENT_META_CONTAINER, meta);

  const touchedContainers: string[] = [];
  const setCalls: { key: string; value: number }[] = [];
  let commits = 0;

  return {
    document: {
      getMap(name: string) {
        touchedContainers.push(name);
        let container = containers.get(name);
        if (!container) {
          container = new Map<string, unknown>();
          containers.set(name, container);
        }
        const target = container;
        return {
          get: (key: string) => target.get(key),
          set: (key: string, value: number) => {
            setCalls.push({ key, value });
            target.set(key, value);
          },
        };
      },
      commit() {
        commits += 1;
      },
    },
    current: () => meta.get(GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY),
    touchedContainers,
    setCalls,
    commitCount: () => commits,
  };
}

/** A document whose reserved container cannot be reached at all. */
const unreachableDocument = {
  getMap(): never {
    throw new Error("root container unavailable");
  },
  commit(): void {
    throw new Error("commit must never be reached on an unreadable document");
  },
};

describe("document schema gate: the on-disk contract", () => {
  it("keeps the reserved container and key names frozen", () => {
    // These two strings are durable on-disk contract. Renaming either makes
    // every already-persisted document read as "no generation recorded" —
    // the one reading that must never be produced by accident. Pinned here
    // as literals so a rename fails a test rather than silently changing
    // what every existing document means.
    expect(GRAPH_DOCUMENT_META_CONTAINER).toBe("__vulto_document_meta");
    expect(GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY).toBe("schema_generation");
  });

  it("reads the generation off the reserved container by name and nothing else", () => {
    const fake = fakeDocument({
      present: true,
      value: GRAPH_DOCUMENT_SCHEMA_GENERATION,
    });
    assertDocumentSchemaGenerationReadable(fake.document);
    // The whole point of the reserved root container is that reading it
    // never walks into node fragments, edges, or the Movable Tree — any of
    // which a future generation may have restructured.
    expect(new Set(fake.touchedContainers)).toEqual(
      new Set([GRAPH_DOCUMENT_META_CONTAINER]),
    );
  });
});

describe("document schema gate: readDocumentSchemaGeneration", () => {
  it("reports an unmarked document as absent", () => {
    expect(
      readDocumentSchemaGeneration(fakeDocument({ present: false }).document),
    ).toEqual({ kind: "absent" });
  });

  it("treats an explicit null the same as absent", () => {
    expect(
      readDocumentSchemaGeneration(
        fakeDocument({ present: true, value: null }).document,
      ),
    ).toEqual({ kind: "absent" });
  });

  it("reports a positive integer as recorded", () => {
    expect(
      readDocumentSchemaGeneration(fakeDocument({ present: true, value: 7 }).document),
    ).toEqual({ kind: "recorded", generation: 7 });
  });

  it("reports a failure to reach the container as unreadable, never as absent", () => {
    const reading = readDocumentSchemaGeneration(unreachableDocument);
    // "Cannot establish what generation this is" must never collapse into
    // "no generation recorded", because absent is the case that proceeds.
    expect(reading.kind).toBe("unreadable");
  });
});

describe("document schema gate: assertDocumentSchemaGenerationReadable", () => {
  it("proceeds when nothing is recorded", () => {
    // Deliberate: a document with no generation was written before this
    // gate shipped, and a newer client reading an older document is the
    // direction A002-T04's additive-only evolution guarantees is safe.
    expect(() =>
      assertDocumentSchemaGenerationReadable(fakeDocument({ present: false }).document),
    ).not.toThrow();
  });

  it("proceeds on a generation inside the readable range", () => {
    for (
      let generation = MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION;
      generation <= GRAPH_DOCUMENT_SCHEMA_GENERATION;
      generation += 1
    ) {
      expect(() =>
        assertDocumentSchemaGenerationReadable(
          fakeDocument({ present: true, value: generation }).document,
        ),
      ).not.toThrow();
    }
  });

  it("refuses a document written by a newer client, carrying the recorded generation", () => {
    // The case Decision 3 exists for: an older build opening a document a
    // newer client already wrote.
    const recorded = GRAPH_DOCUMENT_SCHEMA_GENERATION + 1;
    let caught: unknown;
    try {
      assertDocumentSchemaGenerationReadable(
        fakeDocument({ present: true, value: recorded }).document,
      );
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedDocumentSchemaGenerationError);
    const error = caught as UnsupportedDocumentSchemaGenerationError;
    expect(error.recordedGeneration).toBe(recorded);
    expect(error.currentGeneration).toBe(GRAPH_DOCUMENT_SCHEMA_GENERATION);
    expect(error.minimumReadableGeneration).toBe(
      MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
    );
  });

  it("refuses a generation far beyond this build's range", () => {
    expect(() =>
      assertDocumentSchemaGenerationReadable(
        fakeDocument({ present: true, value: 9_999 }).document,
      ),
    ).toThrow(UnsupportedDocumentSchemaGenerationError);
  });

  it.each([
    ["a non-integer", 1.5],
    ["zero", 0],
    ["a negative integer", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "1"],
    ["an arbitrary string", "generation-one"],
    ["an object", { generation: 1 }],
    ["an array", [1]],
    ["a boolean", true],
  ])(
    "refuses %s as an unreadable marker with a null recordedGeneration",
    (_label, value) => {
      let caught: unknown;
      try {
        assertDocumentSchemaGenerationReadable(
          fakeDocument({ present: true, value }).document,
        );
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnsupportedDocumentSchemaGenerationError);
      // A marker this build cannot interpret is not evidence of
      // compatibility: it fails closed, and reports no generation because it
      // genuinely established none.
      expect(
        (caught as UnsupportedDocumentSchemaGenerationError).recordedGeneration,
      ).toBe(null);
    },
  );

  it("fails closed when reaching the reserved container itself throws", () => {
    let caught: unknown;
    try {
      assertDocumentSchemaGenerationReadable(unreachableDocument);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedDocumentSchemaGenerationError);
    expect(
      (caught as UnsupportedDocumentSchemaGenerationError).recordedGeneration,
    ).toBe(null);
  });

  it("raises a refusal distinct from every other failure the caller can see", () => {
    const error = new UnsupportedDocumentSchemaGenerationError(
      GRAPH_DOCUMENT_SCHEMA_GENERATION + 1,
    );
    // The store unlocked, the bytes authenticated, and the document
    // imported. Collapsing this into a sealed-store failure would tell the
    // layer above to re-unlock, re-key, or re-sync — none of which help.
    expect(error).toBeInstanceOf(Error);
    expect(error.constructor).toBe(UnsupportedDocumentSchemaGenerationError);
    expect(error.name).not.toMatch(/SealedStore/);
  });
});

describe("document schema gate: the below-minimum bound", () => {
  /**
   * The below-minimum refusal is NOT reachable through
   * assertDocumentSchemaGenerationReadable on this build, and that is a
   * property of the constants rather than a gap in the gate:
   * readDocumentSchemaGeneration only returns `recorded` for an integer
   * strictly greater than zero, and the minimum readable generation is 1.
   * Every value below the minimum is therefore classified `unreadable`
   * first and refused on that branch — covered above — so no input exists
   * that reaches the below-minimum comparison.
   *
   * What can be proved today is the predicate the gate delegates that
   * comparison to, which is what starts refusing real documents the day a
   * superseded generation is dropped by raising the minimum. These assert
   * the bound is genuinely a closed range, so that change is a one-line
   * edit with test coverage already waiting for it.
   */
  it("confirms the two constants that make the case unreachable today", () => {
    expect(MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION).toBe(1);
    expect(GRAPH_DOCUMENT_SCHEMA_GENERATION).toBeGreaterThanOrEqual(
      MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
    );
  });

  it("rejects generations below the minimum through the predicate itself", () => {
    expect(
      isReadableGraphDocumentSchemaGeneration(
        MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION - 1,
      ),
    ).toBe(false);
    expect(isReadableGraphDocumentSchemaGeneration(-5)).toBe(false);
  });

  it("accepts both ends of the closed range and rejects just past the top", () => {
    expect(
      isReadableGraphDocumentSchemaGeneration(
        MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
      ),
    ).toBe(true);
    expect(
      isReadableGraphDocumentSchemaGeneration(GRAPH_DOCUMENT_SCHEMA_GENERATION),
    ).toBe(true);
    expect(
      isReadableGraphDocumentSchemaGeneration(GRAPH_DOCUMENT_SCHEMA_GENERATION + 1),
    ).toBe(false);
  });

  it("rejects non-integers through the predicate", () => {
    expect(isReadableGraphDocumentSchemaGeneration(1.5)).toBe(false);
    expect(isReadableGraphDocumentSchemaGeneration(Number.NaN)).toBe(false);
  });
});

describe("document schema gate: stampDocumentSchemaGeneration", () => {
  it("stamps the current generation on a document carrying none", () => {
    const fake = fakeDocument({ present: false });
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.current()).toBe(GRAPH_DOCUMENT_SCHEMA_GENERATION);
    expect(fake.setCalls).toEqual([
      {
        key: GRAPH_DOCUMENT_SCHEMA_GENERATION_KEY,
        value: GRAPH_DOCUMENT_SCHEMA_GENERATION,
      },
    ]);
    expect(fake.commitCount()).toBe(1);
  });

  it("is a genuine no-op when the recorded generation already equals this build's", () => {
    const fake = fakeDocument({
      present: true,
      value: GRAPH_DOCUMENT_SCHEMA_GENERATION,
    });
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.current()).toBe(GRAPH_DOCUMENT_SCHEMA_GENERATION);
    // Proved by the absence of a write, not by the value looking unchanged:
    // re-committing on every flush would grow history for no reason.
    expect(fake.setCalls).toEqual([]);
    expect(fake.commitCount()).toBe(0);
  });

  it("never lowers a higher generation recorded by a newer client", () => {
    // The one that matters. A document carrying a higher generation got
    // there by merging a delta a newer client authored. Stamping this
    // build's own lower number over it would erase the marker that stops
    // this build from misreading that document on the next reopen — the
    // gate would then read a compatible generation and let it through.
    const newer = GRAPH_DOCUMENT_SCHEMA_GENERATION + 1;
    const fake = fakeDocument({ present: true, value: newer });
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.current()).toBe(newer);
    expect(fake.setCalls).toEqual([]);
    expect(fake.commitCount()).toBe(0);

    // And the marker it left behind still refuses the document.
    expect(() => assertDocumentSchemaGenerationReadable(fake.document)).toThrow(
      UnsupportedDocumentSchemaGenerationError,
    );
  });

  it("leaves a far-newer generation untouched", () => {
    const fake = fakeDocument({ present: true, value: 9_999 });
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.current()).toBe(9_999);
    expect(fake.setCalls).toEqual([]);
    expect(fake.commitCount()).toBe(0);
  });

  it.each([
    ["a non-integer", 1.5],
    ["zero", 0],
    ["a negative integer", -1],
    ["a string", "two"],
    ["an object", { generation: 2 }],
  ])("leaves %s untouched rather than overwriting it", (_label, value) => {
    // Same reasoning as the higher-generation case: a marker this build
    // cannot interpret may be a newer client's, and overwriting it would
    // convert an unreadable document into one this build wrongly accepts.
    const fake = fakeDocument({ present: true, value });
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.current()).toEqual(value);
    expect(fake.setCalls).toEqual([]);
    expect(fake.commitCount()).toBe(0);
  });

  it("does not throw when the reserved container cannot be reached", () => {
    // A flush must not be turned into a crash by an unreadable marker; the
    // refusal belongs on the next open, where the gate runs.
    expect(() => stampDocumentSchemaGeneration(unreachableDocument)).not.toThrow();
  });

  it("stamps once, then stays a no-op across repeated flushes", () => {
    const fake = fakeDocument({ present: false });
    stampDocumentSchemaGeneration(fake.document);
    stampDocumentSchemaGeneration(fake.document);
    stampDocumentSchemaGeneration(fake.document);
    expect(fake.setCalls).toHaveLength(1);
    expect(fake.commitCount()).toBe(1);
  });

  it("produces a document the gate then accepts", () => {
    const fake = fakeDocument({ present: false });
    stampDocumentSchemaGeneration(fake.document);
    expect(() => assertDocumentSchemaGenerationReadable(fake.document)).not.toThrow();
  });
});

describe("document-level generation and record-level tolerance are separate", () => {
  const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
  const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
  const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
  const NOW = "2026-08-17T10:30:00.000Z";

  function employeeWithUnknownProperty(): NodeFragmentInput {
    return {
      sourceDocumentId: `employee-${EMPLOYEE}`,
      partitionKey: "operational",
      record: {
        node_id: EMPLOYEE,
        workspace_id: WORKSPACE,
        node_type: "Employee",
        schema_version: 1,
        lifecycle_status: "Active",
        created_at: NOW,
        created_by: ACTOR,
        updated_at: NOW,
        updated_by: ACTOR,
        is_soft_deleted: false,
        soft_deleted_at: null,
        soft_deleted_by: null,
        display_name: EMPLOYEE,
        // Purely additive, and unknown to this build — exactly what
        // A002-T07 requires an older client to tolerate rather than fail on.
        vulto_future_additive_property: "written by a later schema version",
      },
    };
  }

  it("tolerates an unrecognized additive property on a record (A002-T07)", () => {
    const validated = validateGraphSnapshot(
      { nodeFragments: [employeeWithUnknownProperty()], edges: [] },
      WORKSPACE,
    );
    expect(validated.nodeFragments).toHaveLength(1);
    const fragment = validated.nodeFragments[0];
    if (!fragment) throw new Error("the tolerated fragment was dropped entirely");
    // Tolerated AND preserved: dropping it would lose a newer client's data
    // on the next write-back.
    expect(
      (fragment.record as Record<string, unknown>).vulto_future_additive_property,
    ).toBe("written by a later schema version");
  });

  it("does not let record content influence the document-level decision", () => {
    // The gate reads one scalar on one reserved container. A document full
    // of records carrying unknown properties is still opened, because the
    // question it answers is about the document, not about any record in
    // it. Conflating the two is what would let an older client tolerate its
    // way, one unknown property at a time, into a partial wrong view.
    const fake = fakeDocument({
      present: true,
      value: GRAPH_DOCUMENT_SCHEMA_GENERATION,
    });
    fake.document
      .getMap("some-node-fragment-container")
      .set("vulto_future_additive_property", 1);
    expect(() => assertDocumentSchemaGenerationReadable(fake.document)).not.toThrow();
  });
});
