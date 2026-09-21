import { describe, expect, it } from "vitest";
import { auditEntrySchema } from "./audit";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const validEntry = {
  audit_entry_id: ID,
  schema_version: 1,
  workspace_id: OTHER_ID,
  event_type: "AuthorizedOperationFailed",
  operation: "NodeUpdate",
  outcome: "Failed",
  actor_user_id: ID,
  actor_membership_id: OTHER_ID,
  actor_role: "owner",
  actor_roles: ["owner", "hr-admin"],
  actor_application: "VultoRoster",
  target: {
    kind: "NodeTarget",
    node_type: "Employee",
    node_id: ID,
    partition_key: "compensation",
    target_tier: 1,
  },
  metadata: { failure_class: "CommitFailed", result_cardinality: "Single" },
  occurred_at: "2026-09-10T09:00:00.000Z",
} as const;

describe("VPS-F004 canonical AuditEntry contract", () => {
  it("accepts the closed event vocabulary and supplies the application default", () => {
    const { actor_application: _application, ...withoutApplication } = validEntry;
    expect(auditEntrySchema.parse(withoutApplication).actor_application).toBe(
      "VultoRoster",
    );
  });

  it("rejects arbitrary target, metadata, and top-level values", () => {
    expect(() =>
      auditEntrySchema.parse({
        ...validEntry,
        target: { ...validEntry.target, hidden_value: "salary" },
      }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...validEntry,
        metadata: { ...validEntry.metadata, exception_text: "secret" },
      }),
    ).toThrow();
    expect(() => auditEntrySchema.parse({ ...validEntry, free_form: true })).toThrow();
  });

  it("requires coherent event outcomes and a closed failure class", () => {
    expect(() =>
      auditEntrySchema.parse({ ...validEntry, outcome: "Granted" }),
    ).toThrow();
    expect(() => auditEntrySchema.parse({ ...validEntry, metadata: {} })).toThrow();
  });

  it("requires the closed privileged-projection metadata and a null actor role", () => {
    const projection = {
      ...validEntry,
      event_type: "PrivilegedProjectionAuthorized",
      operation: "NodeCreate",
      outcome: "Granted",
      actor_role: null,
      target: {
        kind: "NodeTarget",
        node_type: "WorkspaceMembership",
        node_id: OTHER_ID,
        partition_key: "record",
        target_tier: 0,
      },
      metadata: {
        authorization_path: "PrivilegedProjectionException",
        projection_kind: "Admission",
        result_cardinality: "Single",
      },
    } as const;
    expect(auditEntrySchema.parse(projection)).toMatchObject(projection);
    expect(() =>
      auditEntrySchema.parse({ ...projection, actor_role: "owner" }),
    ).toThrow("cannot name a deciding role");
    expect(() =>
      auditEntrySchema.parse({
        ...projection,
        metadata: { ...projection.metadata, projection_kind: undefined },
      }),
    ).toThrow("requires its closed projection_kind");
    expect(() =>
      auditEntrySchema.parse({
        ...validEntry,
        metadata: {
          ...validEntry.metadata,
          authorization_path: "PrivilegedProjectionException",
        },
      }),
    ).toThrow("belongs only to privileged projections");
  });
});

describe("F206 — the audit actor", () => {
  const {
    actor_user_id: _u,
    actor_membership_id: _m,
    actor_role: _r,
    actor_roles: _rs,
    ...rest
  } = validEntry;
  const nonMember = { ...rest, actor_role: null, actor_roles: [] };

  it("defaults to a member and requires the person's ids", () => {
    expect(auditEntrySchema.parse(validEntry).actor_kind).toBe("member");
    expect(() =>
      auditEntrySchema.parse({ ...validEntry, actor_user_id: undefined }),
    ).toThrow();
    expect(() => auditEntrySchema.parse({ ...validEntry, actor_roles: [] })).toThrow();
  });

  it("names a support grant by its grant id alone", () => {
    const entry = auditEntrySchema.parse({
      ...nonMember,
      actor_kind: "support",
      actor_grant_id: OTHER_ID,
    });
    expect(entry.actor_grant_id).toBe(OTHER_ID);
    expect(() =>
      auditEntrySchema.parse({ ...nonMember, actor_kind: "support" }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...nonMember,
        actor_kind: "support",
        actor_grant_id: OTHER_ID,
        actor_user_id: ID,
      }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...nonMember,
        actor_kind: "support",
        actor_grant_id: OTHER_ID,
        actor_roles: ["owner"],
      }),
    ).toThrow();
  });

  it("names a system job by its closed name alone", () => {
    const entry = auditEntrySchema.parse({
      ...nonMember,
      actor_kind: "system",
      actor_system_name: "erasure",
    });
    expect(entry.actor_system_name).toBe("erasure");
    expect(() =>
      auditEntrySchema.parse({
        ...nonMember,
        actor_kind: "system",
        actor_system_name: "cron",
      }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({ ...nonMember, actor_kind: "system" }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...nonMember,
        actor_kind: "system",
        actor_system_name: "erasure",
        actor_grant_id: OTHER_ID,
      }),
    ).toThrow();
  });
});

describe("F209 — the cryptographic erasure event", () => {
  const erasure = {
    ...validEntry,
    event_type: "CryptographicErasureExecuted",
    operation: "KeyDestroy",
    outcome: "Granted",
    actor_kind: "system",
    actor_system_name: "erasure",
    actor_user_id: undefined,
    actor_membership_id: undefined,
    actor_role: null,
    actor_roles: [],
    target: {
      kind: "ErasureTarget",
      erasure_domain_id: ID,
      tier: 1,
      destroyed_key_count: 2,
      erasure_request_id: null,
    },
    metadata: {},
  };

  it("accepts an erasure by the erasure system principal, with or without a request id", () => {
    expect(auditEntrySchema.parse(erasure).target).toMatchObject({
      kind: "ErasureTarget",
      destroyed_key_count: 2,
    });
    expect(
      auditEntrySchema.parse({
        ...erasure,
        target: { ...erasure.target, erasure_request_id: OTHER_ID },
      }).target,
    ).toMatchObject({ erasure_request_id: OTHER_ID });
  });

  it("refuses any other actor, operation or target, and any content in the target", () => {
    expect(() =>
      auditEntrySchema.parse({ ...erasure, actor_system_name: "key-rotation" }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...erasure,
        actor_kind: "member",
        actor_system_name: undefined,
      }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({ ...erasure, operation: "NodeUpdate" }),
    ).toThrow();
    expect(() => auditEntrySchema.parse({ ...erasure, outcome: "Denied" })).toThrow();
    expect(() =>
      auditEntrySchema.parse({ ...erasure, target: { ...erasure.target, salary: 1 } }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({
        ...erasure,
        target: { ...erasure.target, erasure_request_id: undefined },
      }),
    ).toThrow();
  });

  it("keeps KeyDestroy and ErasureTarget for the erasure event alone", () => {
    expect(() =>
      auditEntrySchema.parse({ ...validEntry, operation: "KeyDestroy" }),
    ).toThrow();
    expect(() =>
      auditEntrySchema.parse({ ...validEntry, target: erasure.target }),
    ).toThrow();
  });
});
