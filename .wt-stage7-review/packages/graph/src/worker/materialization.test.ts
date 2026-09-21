import { describe, expect, it } from "vitest";
import {
  applyGraphBatch,
  validateGraphSnapshot,
  type EdgeInput,
  type NodeFragmentInput,
} from "./materialization";

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
const MANAGER_A = "123e4567-e89b-42d3-a456-426614174003";
const MANAGER_B = "123e4567-e89b-42d3-a456-426614174004";
const ENTITY_A = "123e4567-e89b-42d3-a456-426614174005";
const ENTITY_B = "123e4567-e89b-42d3-a456-426614174006";
const NOW = "2026-08-17T10:30:00.000Z";

function employee(id: string): NodeFragmentInput {
  return {
    sourceDocumentId: `employee-${id}`,
    partitionKey: "operational",
    record: {
      node_id: id,
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
      display_name: id,
    },
  };
}

function managedBy(
  id: string,
  managerId: string,
  effectiveFrom: string | null,
  effectiveTo: string | null,
): EdgeInput {
  return {
    sourceDocumentId: `edge-${id}`,
    record: {
      edge_id: id,
      edge_type: "managed_by",
      from_node_id: EMPLOYEE,
      to_node_id: managerId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      created_at: NOW,
      created_by: ACTOR,
      metadata: {},
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    },
  };
}

function entity(id: string): NodeFragmentInput {
  return {
    sourceDocumentId: `entity-${id}`,
    partitionKey: "record",
    record: {
      node_id: id,
      workspace_id: WORKSPACE,
      node_type: "Entity",
      schema_version: 1,
      lifecycle_status: "Active",
      created_at: NOW,
      created_by: ACTOR,
      updated_at: NOW,
      updated_by: ACTOR,
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    },
  };
}

const EDGE_A = "223e4567-e89b-42d3-a456-426614174000";
const EDGE_B = "223e4567-e89b-42d3-a456-426614174001";

describe("graph materialization invariants", () => {
  it("rejects two active targets for one source", () => {
    expect(() =>
      validateGraphSnapshot(
        {
          nodeFragments: [employee(EMPLOYEE), employee(MANAGER_A), employee(MANAGER_B)],
          edges: [
            managedBy(EDGE_A, MANAGER_A, null, null),
            managedBy(EDGE_B, MANAGER_B, null, null),
          ],
        },
        WORKSPACE,
      ),
    ).toThrow(/overlapping active history/);
  });

  it("accepts a half-open handoff and rejects overlap between closed histories", () => {
    const handoff = "2026-08-18T00:00:00.000Z";
    expect(
      validateGraphSnapshot(
        {
          nodeFragments: [employee(EMPLOYEE), employee(MANAGER_A), employee(MANAGER_B)],
          edges: [
            managedBy(EDGE_A, MANAGER_A, null, handoff),
            managedBy(EDGE_B, MANAGER_B, handoff, null),
          ],
        },
        WORKSPACE,
      ).edges,
    ).toHaveLength(2);

    expect(() =>
      validateGraphSnapshot(
        {
          nodeFragments: [employee(EMPLOYEE), employee(MANAGER_A), employee(MANAGER_B)],
          edges: [
            managedBy(EDGE_A, MANAGER_A, null, "2026-08-19T00:00:00.000Z"),
            managedBy(
              EDGE_B,
              MANAGER_B,
              "2026-08-18T00:00:00.000Z",
              "2026-08-20T00:00:00.000Z",
            ),
          ],
        },
        WORKSPACE,
      ),
    ).toThrow(/overlapping active history/);
  });

  it("applies the same source-wide history rule to scoped_to_entity", () => {
    const scoped = (id: string, entityId: string): EdgeInput => ({
      sourceDocumentId: `scope-${id}`,
      record: {
        edge_id: id,
        edge_type: "scoped_to_entity",
        from_node_id: EMPLOYEE,
        to_node_id: entityId,
        effective_from: null,
        effective_to: null,
        created_at: NOW,
        created_by: ACTOR,
        metadata: {},
        is_soft_deleted: false,
        soft_deleted_at: null,
        soft_deleted_by: null,
      },
    });

    expect(() =>
      validateGraphSnapshot(
        {
          nodeFragments: [employee(EMPLOYEE), entity(ENTITY_A), entity(ENTITY_B)],
          edges: [scoped(EDGE_A, ENTITY_A), scoped(EDGE_B, ENTITY_B)],
        },
        WORKSPACE,
      ),
    ).toThrow(/scoped_to_entity has overlapping active history/);
  });

  it("keeps split fragments distinct and rejects conflicting universal fields", () => {
    const operational = employee(EMPLOYEE);
    const compensation = {
      ...operational,
      sourceDocumentId: "employee-compensation",
      partitionKey: "compensation",
      record: { ...(operational.record as object), annual_salary: 100_000 },
    };
    expect(
      validateGraphSnapshot(
        { nodeFragments: [operational, compensation], edges: [] },
        WORKSPACE,
      ).nodeFragments.map(({ partitionKey }) => partitionKey),
    ).toEqual(["operational", "compensation"]);

    expect(() =>
      validateGraphSnapshot(
        {
          nodeFragments: [
            operational,
            {
              ...compensation,
              record: {
                ...(compensation.record as object),
                lifecycle_status: "Inactive",
              },
            },
          ],
          edges: [],
        },
        WORKSPACE,
      ),
    ).toThrow(/conflicting lifecycle_status/);
  });

  it("applies source-document removal without mutating the committed snapshot", () => {
    const current = validateGraphSnapshot(
      { nodeFragments: [employee(EMPLOYEE), employee(MANAGER_A)], edges: [] },
      WORKSPACE,
    );
    const next = applyGraphBatch(
      current,
      {
        nodeFragments: [],
        edges: [],
        removeSourceDocumentIds: [`employee-${MANAGER_A}`],
      },
      WORKSPACE,
    );

    expect(current.nodeFragments).toHaveLength(2);
    expect(next.nodeFragments).toHaveLength(1);
  });
});
