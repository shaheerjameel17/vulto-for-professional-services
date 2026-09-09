import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  EdgeFragmentLayoutError,
  edgeFragmentSourceDocumentId,
  readEdgeFragments,
} from "./document-edge-fragments";
import { readNodeFragments } from "./document-node-fragments";
import { validateGraphSnapshot } from "./materialization";

/**
 * FDN-92 stage 1. These tests drive real `LoroDoc` instances and spell the
 * on-document contract out INDEPENDENTLY of the implementation's own
 * constants — the container name and key format below are literals, never
 * imported. Same discipline `document-node-fragments.test.ts` applies: a
 * rename is exactly the change that must not pass silently, because every
 * already-persisted document would read as "this workspace has no edges."
 */
const CONTAINER = "__vulto_edge_fragments";
const NODE_CONTAINER = "__vulto_node_fragments";

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
const SKILL = "123e4567-e89b-42d3-a456-426614174003";
const EDGE_A = "123e4567-e89b-42d3-a456-4266141740a1";
const EDGE_B = "123e4567-e89b-42d3-a456-4266141740b2";

function hasSkillRecord(
  edgeId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    edge_id: edgeId,
    edge_type: "has_skill",
    from_node_id: EMPLOYEE,
    to_node_id: SKILL,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    created_at: "2025-12-20T08:00:00.000Z",
    created_by: ACTOR,
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...overrides,
  };
}

/** Writes an edge fragment the way the document layout intends: a nested map. */
function writeEdgeAsContainer(
  document: LoroDoc,
  key: string,
  record: Record<string, unknown>,
): void {
  const fragment = document.getMap(CONTAINER).setContainer(key, new LoroMap());
  for (const [field, value] of Object.entries(record)) fragment.set(field, value);
}

function writeNode(
  document: LoroDoc,
  key: string,
  record: Record<string, unknown>,
): void {
  const fragment = document.getMap(NODE_CONTAINER).setContainer(key, new LoroMap());
  for (const [field, value] of Object.entries(record)) fragment.set(field, value);
}

function employeeOperational(): Record<string, unknown> {
  return {
    node_id: EMPLOYEE,
    workspace_id: WORKSPACE,
    node_type: "Employee",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2025-12-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2025-12-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

function skillRecord(): Record<string, unknown> {
  return {
    node_id: SKILL,
    workspace_id: WORKSPACE,
    node_type: "Skill",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2025-12-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2025-12-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

describe("readEdgeFragments", () => {
  it("returns nothing for a document that has no edge fragments at all", () => {
    const document = new LoroDoc();
    expect(readEdgeFragments(document)).toEqual([]);
    document.free();
  });

  it("reads an edge stored as its own nested map", () => {
    const document = new LoroDoc();
    writeEdgeAsContainer(document, EDGE_A, hasSkillRecord(EDGE_A));
    document.commit();

    const edges = readEdgeFragments(document);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceDocumentId).toBe(edgeFragmentSourceDocumentId(EDGE_A));
    // Resolved to a plain record, not a container handle — a handle would
    // fail schema parsing later with a far less obvious message.
    expect(edges[0]!.record).toEqual(hasSkillRecord(EDGE_A));
    document.free();
  });

  it("merges two devices' concurrent edits to DIFFERENT fields of one edge", () => {
    // The reason an edge is its own nested map rather than one plain-object
    // value: a whole-record value is last-write-wins, and one device's edit
    // would silently discard the other's.
    const seedDocument = new LoroDoc();
    seedDocument.setPeerId(1n);
    writeEdgeAsContainer(seedDocument, EDGE_A, hasSkillRecord(EDGE_A));
    seedDocument.commit();
    const seed = seedDocument.export({ mode: "snapshot" });

    const deviceA = new LoroDoc();
    deviceA.setPeerId(21n);
    deviceA.import(seed);
    (deviceA.getMap(CONTAINER).get(EDGE_A) as LoroMap).set("metadata", {
      proficiency: "expert",
    });
    deviceA.commit();

    const deviceB = new LoroDoc();
    deviceB.setPeerId(22n);
    deviceB.import(seed);
    (deviceB.getMap(CONTAINER).get(EDGE_A) as LoroMap).set(
      "effective_to",
      "2027-01-01T00:00:00.000Z",
    );
    deviceB.commit();

    const merged = new LoroDoc();
    merged.import(seed);
    merged.import(deviceA.export({ mode: "snapshot" }));
    merged.import(deviceB.export({ mode: "snapshot" }));

    const record = readEdgeFragments(merged)[0]!.record as Record<string, unknown>;
    expect(record["metadata"]).toEqual({ proficiency: "expert" });
    expect(record["effective_to"]).toBe("2027-01-01T00:00:00.000Z");

    seedDocument.free();
    deviceA.free();
    deviceB.free();
    merged.free();
  });

  it("returns two edges of one source node as separate fragments", () => {
    const document = new LoroDoc();
    writeEdgeAsContainer(document, EDGE_A, hasSkillRecord(EDGE_A));
    writeEdgeAsContainer(
      document,
      EDGE_B,
      hasSkillRecord(EDGE_B, { to_node_id: "123e4567-e89b-42d3-a456-4266141740c3" }),
    );
    document.commit();

    expect(readEdgeFragments(document).map((edge) => edge.sourceDocumentId)).toEqual([
      edgeFragmentSourceDocumentId(EDGE_A),
      edgeFragmentSourceDocumentId(EDGE_B),
    ]);
    document.free();
  });

  it("is a pure function of the document, not of insertion order", () => {
    const forward = new LoroDoc();
    writeEdgeAsContainer(forward, EDGE_A, hasSkillRecord(EDGE_A));
    writeEdgeAsContainer(forward, EDGE_B, hasSkillRecord(EDGE_B));
    forward.commit();

    const reverse = new LoroDoc();
    writeEdgeAsContainer(reverse, EDGE_B, hasSkillRecord(EDGE_B));
    writeEdgeAsContainer(reverse, EDGE_A, hasSkillRecord(EDGE_A));
    reverse.commit();

    expect(JSON.stringify(readEdgeFragments(forward))).toBe(
      JSON.stringify(readEdgeFragments(reverse)),
    );
    forward.free();
    reverse.free();
  });

  it("refuses an edge fragment that is not an object", () => {
    const document = new LoroDoc();
    document.getMap(CONTAINER).set(EDGE_A, "not a record");
    document.commit();
    expect(() => readEdgeFragments(document)).toThrow(EdgeFragmentLayoutError);
    document.free();
  });

  it("refuses a record whose edge_id disagrees with its own key", () => {
    const document = new LoroDoc();
    writeEdgeAsContainer(document, EDGE_A, hasSkillRecord(EDGE_B));
    document.commit();
    expect(() => readEdgeFragments(document)).toThrow(/disagrees with its own key/);
    document.free();
  });

  it("refuses a key that carries surrounding whitespace", () => {
    const document = new LoroDoc();
    writeEdgeAsContainer(document, ` ${EDGE_A}`, hasSkillRecord(EDGE_A));
    document.commit();
    expect(() => readEdgeFragments(document)).toThrow(EdgeFragmentLayoutError);
    document.free();
  });

  it("produces generic edges the materialization layer accepts alongside node fragments", () => {
    // The whole reason this module exists: a generic edge whose endpoints
    // are materialized node fragments passes validateGraphSnapshot exactly
    // as a Tree-derived managed_by edge does.
    const document = new LoroDoc();
    writeNode(document, `${EMPLOYEE}:operational`, employeeOperational());
    writeNode(document, `${SKILL}:record`, skillRecord());
    writeEdgeAsContainer(document, EDGE_A, hasSkillRecord(EDGE_A));
    document.commit();

    const validated = validateGraphSnapshot(
      {
        nodeFragments: readNodeFragments(document),
        edges: readEdgeFragments(document),
      },
      WORKSPACE,
    );
    expect(validated.nodeFragments).toHaveLength(2);
    expect(validated.edges).toHaveLength(1);
    expect(validated.edges[0]!.record.edge_type).toBe("has_skill");
    document.free();
  });
});
