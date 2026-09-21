import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  NodeFragmentLayoutError,
  nodeFragmentSourceDocumentId,
  readNodeFragments,
} from "./document-node-fragments";
import { validateGraphSnapshot } from "./materialization";

/**
 * FDN-50 stage 5. These tests drive real `LoroDoc` instances, and spell the
 * on-document contract out INDEPENDENTLY of the implementation's own
 * constants — the container name and key format below are written as
 * literals, never imported.
 *
 * Deliberate, and the same discipline stage 3's browser proof applies to
 * the document-meta container. Importing the constants would make these
 * tests agree with a rename by construction, and a rename is exactly the
 * change that must not pass silently: every already-persisted document
 * would read as "this workspace has no nodes," which materializes as an
 * empty index rather than as an error.
 */
const CONTAINER = "__vulto_node_fragments";

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
const MANAGER = "123e4567-e89b-42d3-a456-426614174003";

function employeeRecord(nodeId: string, displayName: string): Record<string, unknown> {
  return {
    node_id: nodeId,
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
    display_name: displayName,
  };
}

/** Writes a fragment the way the document layout intends: a nested map. */
function writeFragmentAsContainer(
  document: LoroDoc,
  key: string,
  record: Record<string, unknown>,
): void {
  const fragment = document.getMap(CONTAINER).setContainer(key, new LoroMap());
  for (const [field, value] of Object.entries(record)) fragment.set(field, value);
}

describe("readNodeFragments", () => {
  it("returns nothing for a document that has no fragments at all", () => {
    const document = new LoroDoc();
    expect(readNodeFragments(document)).toEqual([]);
    document.free();
  });

  it("reads a fragment stored as its own nested map", () => {
    const document = new LoroDoc();
    writeFragmentAsContainer(
      document,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    document.commit();

    const fragments = readNodeFragments(document);
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.partitionKey).toBe("operational");
    expect(fragments[0]!.sourceDocumentId).toBe(
      nodeFragmentSourceDocumentId(EMPLOYEE, "operational"),
    );
    // The nested container is resolved to a plain record, not handed back
    // as a container handle — a handle would fail schema parsing later with
    // a far less obvious message.
    expect(fragments[0]!.record).toEqual(employeeRecord(EMPLOYEE, "Employee"));
    document.free();
  });

  it("merges two devices' concurrent edits to DIFFERENT fields of one fragment", () => {
    // The reason a fragment is its own nested map rather than one
    // plain-object value: a whole-record value is a last-write-wins
    // register, and one device's edit would silently discard the other's.
    const seedDocument = new LoroDoc();
    seedDocument.setPeerId(1n);
    writeFragmentAsContainer(
      seedDocument,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    seedDocument.commit();
    const seed = seedDocument.export({ mode: "snapshot" });

    const deviceA = new LoroDoc();
    deviceA.setPeerId(21n);
    deviceA.import(seed);
    (deviceA.getMap(CONTAINER).get(`${EMPLOYEE}:operational`) as LoroMap).set(
      "display_name",
      "Renamed by A",
    );
    deviceA.commit();

    const deviceB = new LoroDoc();
    deviceB.setPeerId(22n);
    deviceB.import(seed);
    (deviceB.getMap(CONTAINER).get(`${EMPLOYEE}:operational`) as LoroMap).set(
      "lifecycle_status",
      "Inactive",
    );
    deviceB.commit();

    const merged = new LoroDoc();
    merged.import(seed);
    merged.import(deviceA.export({ mode: "snapshot" }));
    merged.import(deviceB.export({ mode: "snapshot" }));

    const record = readNodeFragments(merged)[0]!.record as Record<string, unknown>;
    expect(record["display_name"]).toBe("Renamed by A");
    expect(record["lifecycle_status"]).toBe("Inactive");

    seedDocument.free();
    deviceA.free();
    deviceB.free();
    merged.free();
  });

  it("returns one node's several partitions as separate fragments", () => {
    const document = new LoroDoc();
    writeFragmentAsContainer(
      document,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    writeFragmentAsContainer(document, `${EMPLOYEE}:compensation`, {
      ...employeeRecord(EMPLOYEE, "Employee"),
      base_salary: 1,
    });
    document.commit();

    expect(
      readNodeFragments(document).map((fragment) => fragment.partitionKey),
    ).toEqual(["compensation", "operational"]);
    document.free();
  });

  it("is a pure function of the document, not of insertion order", () => {
    const forward = new LoroDoc();
    writeFragmentAsContainer(
      forward,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    writeFragmentAsContainer(
      forward,
      `${MANAGER}:operational`,
      employeeRecord(MANAGER, "Manager"),
    );
    forward.commit();

    const reverse = new LoroDoc();
    writeFragmentAsContainer(
      reverse,
      `${MANAGER}:operational`,
      employeeRecord(MANAGER, "Manager"),
    );
    writeFragmentAsContainer(
      reverse,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    reverse.commit();

    expect(JSON.stringify(readNodeFragments(forward))).toBe(
      JSON.stringify(readNodeFragments(reverse)),
    );
    forward.free();
    reverse.free();
  });

  it("refuses a key that is not <node_id>:<partition_key>", () => {
    const document = new LoroDoc();
    writeFragmentAsContainer(document, EMPLOYEE, employeeRecord(EMPLOYEE, "Employee"));
    document.commit();
    expect(() => readNodeFragments(document)).toThrow(NodeFragmentLayoutError);
    document.free();
  });

  it("refuses a record whose node_id disagrees with its own key", () => {
    const document = new LoroDoc();
    writeFragmentAsContainer(
      document,
      `${EMPLOYEE}:operational`,
      employeeRecord(MANAGER, "Manager"),
    );
    document.commit();
    expect(() => readNodeFragments(document)).toThrow(/disagrees with its own key/);
    document.free();
  });

  it("refuses a fragment that is not an object", () => {
    const document = new LoroDoc();
    document.getMap(CONTAINER).set(`${EMPLOYEE}:operational`, "not a record");
    document.commit();
    expect(() => readNodeFragments(document)).toThrow(NodeFragmentLayoutError);
    document.free();
  });

  it("produces fragments the materialization layer accepts as edge endpoints", () => {
    // The whole reason this module exists: without these fragments, an edge
    // materialized from the Movable Tree is rejected as referencing an
    // endpoint absent from the local materialization.
    const document = new LoroDoc();
    writeFragmentAsContainer(
      document,
      `${EMPLOYEE}:operational`,
      employeeRecord(EMPLOYEE, "Employee"),
    );
    writeFragmentAsContainer(
      document,
      `${MANAGER}:operational`,
      employeeRecord(MANAGER, "Manager"),
    );
    document.commit();

    const validated = validateGraphSnapshot(
      {
        nodeFragments: readNodeFragments(document),
        edges: [
          {
            sourceDocumentId: "movable-tree:org_hierarchy:employee",
            record: {
              edge_id: "123e4567-e89b-42d3-a456-4266141740aa",
              edge_type: "managed_by",
              from_node_id: EMPLOYEE,
              to_node_id: MANAGER,
              effective_from: "2026-01-01T00:00:00.000Z",
              effective_to: null,
              created_at: "2025-12-20T08:00:00.000Z",
              created_by: ACTOR,
              metadata: {},
              is_soft_deleted: false,
              soft_deleted_at: null,
              soft_deleted_by: null,
            },
          },
        ],
      },
      WORKSPACE,
    );
    expect(validated.nodeFragments).toHaveLength(2);
    expect(validated.edges).toHaveLength(1);
    document.free();
  });
});
