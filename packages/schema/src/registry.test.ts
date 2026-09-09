import { describe, expect, it } from "vitest";

import {
  ANONYMITY_REGISTRY,
  CONVERSION_REGISTRY,
  EDGE_REGISTRY,
  EDGE_SOURCE_ROW_COUNT,
  EDGE_TYPES,
  NODE_REGISTRY,
  OWNERSHIP_REGISTRY,
  PRIVACY_CLASSES,
  DEFAULT_PRIVACY_CLASS_TIERS,
  assertRegisteredRelationship,
  edgeRecordSchema,
  getProtectionPartitions,
  nodeRecordSchema,
  resolveInheritedTier,
  resolvePrivacyClassDefaultTier,
  resolveRegisteredProtectionTier,
} from "./index";
import {
  assertGoverningPartitions,
  validateRegistryDefinition,
} from "./registry/validate";
import {
  featureOwnedLifecycle,
  fixedProtection,
  type NodeRegistrationShape,
} from "./registry/types";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-42d3-a456-426614174001";
const NOW = "2026-08-17T10:30:00.000Z";

const mutableFields = {
  updated_at: NOW,
  updated_by: ID,
  is_soft_deleted: false,
  soft_deleted_at: null,
  soft_deleted_by: null,
} as const;

const standardEmployee = {
  node_id: ID,
  workspace_id: OTHER_ID,
  node_type: "Employee",
  schema_version: 1,
  lifecycle_status: "Active",
  created_at: NOW,
  created_by: ID,
  ...mutableFields,
} as const;

describe("canonical registry", () => {
  it("has the specification's exact cardinalities", () => {
    expect(NODE_REGISTRY).toHaveLength(109);
    expect(
      NODE_REGISTRY.filter(({ lifecycle }) => lifecycle.kind === "fixed"),
    ).toHaveLength(28);
    expect(
      NODE_REGISTRY.filter(({ lifecycle }) => lifecycle.kind === "feature-owned"),
    ).toHaveLength(81);
    expect(EDGE_SOURCE_ROW_COUNT).toBe(83);
    expect(EDGE_TYPES).toHaveLength(79);
    expect(EDGE_REGISTRY).toHaveLength(110);
    expect(PRIVACY_CLASSES).toHaveLength(13);
    expect(OWNERSHIP_REGISTRY).toHaveLength(10);
  });

  it("closes protection and universal-field policy cardinalities", () => {
    expect(
      NODE_REGISTRY.filter(({ protection }) => protection.kind === "split"),
    ).toHaveLength(9);
    expect(
      NODE_REGISTRY.filter(({ protection }) => protection.kind === "inherited"),
    ).toHaveLength(6);
    expect(
      NODE_REGISTRY.filter(
        ({ protection }) =>
          protection.kind === "fixed" && protection.tierDepartureReason !== undefined,
      ).map(({ nodeType }) => nodeType),
    ).toEqual(["HeadcountSnapshot"]);
    expect(
      NODE_REGISTRY.filter(({ universalFields }) => universalFields !== "standard").map(
        ({ nodeType, universalFields }) => ({
          nodeType,
          universalFields,
        }),
      ),
    ).toEqual([
      {
        nodeType: "PulseAggregateContribution",
        universalFields: "anonymous-contribution",
      },
      {
        nodeType: "WellnessAggregateContribution",
        universalFields: "anonymous-contribution",
      },
      { nodeType: "AuditEntry", universalFields: "immutable-audit" },
    ]);
  });

  it("registers exact triples and keeps endpoint sets away from anonymous nodes", () => {
    expect(
      assertRegisteredRelationship("assigned_to", "Assignment", "Project"),
    ).toMatchObject({
      fromNodeType: "Assignment",
      toNodeType: "Project",
    });
    expect(
      assertRegisteredRelationship("affects", "Insight", "Employee"),
    ).toMatchObject({ toNodeType: "Any non-anonymity-protected node" });
    expect(() =>
      assertRegisteredRelationship(
        "references",
        "GraphReference",
        "PulseAggregateContribution",
      ),
    ).toThrow(/Unregistered relationship/);
    expect(() =>
      assertRegisteredRelationship("assigned_to", "Employee", "Project"),
    ).toThrow(/Unregistered relationship/);
  });

  it("registers domain-correct conversion terminal statuses", () => {
    expect(CONVERSION_REGISTRY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeType: "GhostResource",
          sourceTerminalStatus: "Promoted",
        }),
        expect.objectContaining({
          sourceNodeType: "Candidate",
          sourceTerminalStatus: "Converted",
        }),
      ]),
    );
  });

  it("resolves inherited tiers conservatively and refuses an empty source set", () => {
    expect(resolveInheritedTier([0, 2, 1])).toBe(2);
    expect(resolveInheritedTier([3, 0])).toBe(3);
    expect(() => resolveInheritedTier([])).toThrow(/at least one source tier/);
  });

  it("enforces A003's total Privacy Class tier map and explicit registered departures", () => {
    expect(Object.keys(DEFAULT_PRIVACY_CLASS_TIERS).sort()).toEqual(
      PRIVACY_CLASSES.filter((value) => value !== "Inherited").sort(),
    );
    expect(resolvePrivacyClassDefaultTier("Finance-restricted")).toBe(1);
    expect(resolvePrivacyClassDefaultTier("Self-only, absolute")).toBe(3);
    expect(resolvePrivacyClassDefaultTier("Inherited", [0, 2, 1])).toBe(2);
    expect(
      resolveRegisteredProtectionTier({
        nodeType: "HeadcountSnapshot",
        schemaPartition: "record",
      }),
    ).toBe(0);
    expect(
      resolveRegisteredProtectionTier({
        nodeType: "HRCase",
        schemaPartition: "content",
      }),
    ).toBe(1);
  });

  it("fails closed for unknown classes, unresolved inheritance, and unknown split partitions", () => {
    expect(() => resolvePrivacyClassDefaultTier("Invented")).toThrow(
      /Unknown Privacy Class/,
    );
    expect(() => resolvePrivacyClassDefaultTier("Inherited")).toThrow(
      /at least one source tier/,
    );
    expect(() =>
      resolveRegisteredProtectionTier({
        nodeType: "Employee",
        schemaPartition: "invented",
      }),
    ).toThrow(/Unknown protection partition/);
    expect(() =>
      resolveRegisteredProtectionTier({
        nodeType: "Document",
        schemaPartition: "record",
      }),
    ).toThrow(/at least one source tier/);
  });

  it("exposes guaranteed partitions without reading instance data", () => {
    expect(getProtectionPartitions("Employee")).toEqual([
      { key: "operational", privacyClass: "Standard", tier: 0 },
      {
        key: "compensation",
        privacyClass: "Finance-restricted",
        tier: 1,
      },
    ]);
    expect(getProtectionPartitions("Document")).toEqual([]);
  });
});

describe("wire records", () => {
  it("parses JSON-native nodes and preserves unknown additive properties", () => {
    const parsed = nodeRecordSchema.parse({
      ...standardEmployee,
      future_property: { nested: [true, 4, null] },
    });

    expect(parsed.future_property).toEqual({ nested: [true, 4, null] });
  });

  it("rejects runtime-specific values in additive properties", () => {
    expect(() =>
      nodeRecordSchema.parse({
        ...standardEmployee,
        runtime_date: new Date(NOW),
      }),
    ).toThrow(/JSON-native values only/);
    expect(() =>
      nodeRecordSchema.parse({
        ...standardEmployee,
        undefined_value: undefined,
      }),
    ).toThrow(/JSON-native values only/);
  });

  it("enforces fixed lifecycle policies but accepts feature-owned states", () => {
    expect(() =>
      nodeRecordSchema.parse({
        ...standardEmployee,
        lifecycle_status: "Invented",
      }),
    ).toThrow(/not a registered lifecycle status/);

    expect(
      nodeRecordSchema.parse({
        ...standardEmployee,
        node_type: "LeaveRequest",
        lifecycle_status: "FeatureDefinedState",
      }).lifecycle_status,
    ).toBe("FeatureDefinedState");
  });

  it("keeps User and Workspace outside workspace scope", () => {
    const user = {
      ...standardEmployee,
      node_type: "User",
      lifecycle_status: "Active",
    };
    const { workspace_id: _workspaceId, ...unscoped } = user;

    expect(nodeRecordSchema.parse(unscoped).node_type).toBe("User");
    expect(() => nodeRecordSchema.parse(user)).toThrow();
  });

  it("enforces the closed AuditEntry and anonymous-contribution omissions", () => {
    const audit = {
      node_id: ID,
      workspace_id: OTHER_ID,
      node_type: "AuditEntry",
      schema_version: 1,
      lifecycle_status: "Recorded",
      created_at: NOW,
      created_by: ID,
    } as const;
    expect(nodeRecordSchema.parse(audit).node_type).toBe("AuditEntry");
    expect(() => nodeRecordSchema.parse({ ...audit, updated_at: NOW })).toThrow();

    const anonymous = {
      node_id: ID,
      workspace_id: OTHER_ID,
      node_type: "PulseAggregateContribution",
      schema_version: 1,
      lifecycle_status: "Recorded",
      is_soft_deleted: false,
    } as const;

    expect(nodeRecordSchema.parse(anonymous).node_type).toBe(
      "PulseAggregateContribution",
    );
    for (const forbidden of [
      { created_at: NOW },
      { created_by: ID },
      { updated_at: NOW },
      { updated_by: ID },
      { soft_deleted_at: NOW },
      { soft_deleted_by: ID },
    ]) {
      expect(() => nodeRecordSchema.parse({ ...anonymous, ...forbidden })).toThrow();
    }
  });

  it("enumerates every relationship permitted for anonymity-protected nodes", () => {
    expect(ANONYMITY_REGISTRY).toEqual([
      {
        nodeType: "PulseAggregateContribution",
        allowedRelationships: [
          {
            edgeType: "part_of",
            direction: "outgoing",
            otherNodeType: "PulseCycle",
          },
        ],
      },
      {
        nodeType: "WellnessAggregateContribution",
        allowedRelationships: [],
      },
    ]);
  });

  it("rejects a future anonymity-protected type with wildcard adjacency at import", async () => {
    await expect(
      import("./registry/fixtures/future-anonymity-wildcard.fixture.js"),
    ).rejects.toThrow(
      /Anonymity-protected FutureAnonymousContribution has non-exact outgoing endpoint on future_broad_relationship/,
    );
  });

  it("requires coherent soft-delete provenance and UTC string timestamps", () => {
    expect(() =>
      nodeRecordSchema.parse({
        ...standardEmployee,
        is_soft_deleted: true,
      }),
    ).toThrow(/Soft deletion requires/);
    expect(() =>
      nodeRecordSchema.parse({
        ...standardEmployee,
        updated_at: new Date(NOW),
      }),
    ).toThrow();
  });

  it("parses edge metadata as JSON-native values", () => {
    const edge = {
      edge_id: ID,
      edge_type: "assigned_to",
      from_node_id: ID,
      to_node_id: OTHER_ID,
      effective_from: NOW,
      effective_to: null,
      created_at: NOW,
      created_by: ID,
      metadata: { allocation: 0.5, labels: ["planned"] },
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    } as const;

    expect(edgeRecordSchema.parse(edge).metadata).toEqual({
      allocation: 0.5,
      labels: ["planned"],
    });
    expect(() =>
      edgeRecordSchema.parse({ ...edge, runtime_date: new Date(NOW) }),
    ).toThrow(/JSON-native values only/);
    expect(() =>
      edgeRecordSchema.parse({
        ...edge,
        effective_to: "2026-08-17T09:30:00.000Z",
      }),
    ).toThrow(/half-open interval/);
  });
});

describe("malformed registry fixtures", () => {
  const fixtureNode: NodeRegistrationShape = {
    nodeType: "Example",
    owner: "fixture",
    lifecycle: featureOwnedLifecycle,
    protection: fixedProtection("Standard", 0),
    universalFields: "standard",
  };

  it("rejects duplicate node types", () => {
    expect(() =>
      validateRegistryDefinition({
        nodes: [fixtureNode, fixtureNode],
        edges: [],
      }),
    ).toThrow(/Duplicate node type/);
  });

  it("rejects unknown endpoints", () => {
    expect(() =>
      validateRegistryDefinition({
        nodes: [fixtureNode],
        edges: [
          {
            edgeType: "fixture_edge",
            fromNodeType: "Example",
            toNodeType: "Missing",
            owner: "fixture",
          },
        ],
      }),
    ).toThrow(/Unknown endpoint Missing/);
  });

  it("rejects duplicate edge triples", () => {
    const edge = {
      edgeType: "fixture_edge",
      fromNodeType: "Example",
      toNodeType: "Example",
      owner: "fixture",
    } as const;

    expect(() =>
      validateRegistryDefinition({
        nodes: [fixtureNode],
        edges: [edge, edge],
      }),
    ).toThrow(/Duplicate edge triple/);
  });
});

describe("assertGoverningPartitions (F136 / FDN-92)", () => {
  it("accepts the real registry — the four declared governing partitions are valid", () => {
    expect(() => assertGoverningPartitions()).not.toThrow();
  });

  it("rejects a governing partition for a node type that is not split", () => {
    expect(() =>
      assertGoverningPartitions([
        {
          edgeType: "has_skill",
          pairs: [["Employee", "Skill"]],
          governingPartitions: { Skill: "record" },
        },
      ]),
    ).toThrow(/Skill, which is not split/);
  });

  it("rejects an unknown partition key for a split node type", () => {
    expect(() =>
      assertGoverningPartitions([
        {
          edgeType: "has_skill",
          pairs: [["Employee", "Skill"]],
          governingPartitions: { Employee: "operatoinal" },
        },
      ]),
    ).toThrow(/names partition "operatoinal" for Employee/);
  });

  it("rejects a governing partition for a node type that is not a direct endpoint", () => {
    expect(() =>
      assertGoverningPartitions([
        {
          edgeType: "has_skill",
          pairs: [["Employee", "Skill"]],
          governingPartitions: { Workspace: "display" },
        },
      ]),
    ).toThrow(/Workspace, which is not a direct endpoint/);
  });
});
