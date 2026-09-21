import { randomUUID } from "node:crypto";
import { auditEntrySchema, type AuditEntry } from "@vulto/schema";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { makeWorkspace } from "../permission/test-support.js";
import * as journal from "./journal.js";
import { AuditJournalConflictError, appendAudit } from "./journal.js";
import {
  AuditPseudonymizationDeniedError,
  pseudonymizeActor,
} from "./pseudonymizer.js";
import { auditJournal } from "./schema.js";

afterAll(closeDatabase);

function entry(
  workspaceId: string,
  actorUserId: string,
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return auditEntrySchema.parse({
    audit_entry_id: randomUUID(),
    schema_version: 1,
    workspace_id: workspaceId,
    event_type: "PermissionDenied",
    operation: "NodeRead",
    outcome: "Denied",
    actor_user_id: actorUserId,
    actor_membership_id: randomUUID(),
    actor_role: null,
    actor_roles: ["team-member"],
    actor_application: "VultoRoster",
    target: {
      kind: "NodeTarget",
      node_type: "HRCase",
      node_id: randomUUID(),
      partition_key: "identifying",
      target_tier: 1,
    },
    metadata: { denial_class: "InsufficientPermission", result_cardinality: "Single" },
    occurred_at: "2026-09-21T09:00:00.000Z",
    ...overrides,
  });
}

describe("appendAudit", () => {
  it("is idempotent on audit_entry_id and rejects a different body under the same id", async () => {
    const fixture = await makeWorkspace();
    const e = entry(fixture.workspaceId, randomUUID());
    await db.transaction(async (tx) => {
      expect(await appendAudit(tx, e)).toEqual({ appended: true });
      expect(await appendAudit(tx, e)).toEqual({ appended: false });
    });
    await expect(
      db.transaction((tx) => appendAudit(tx, { ...e, operation: "NodeList" })),
    ).rejects.toBeInstanceOf(AuditJournalConflictError);
    expect(
      await db
        .select()
        .from(auditJournal)
        .where(eq(auditJournal.auditEntryId, e.audit_entry_id)),
    ).toHaveLength(1);
  });

  it("validates the closed vocabulary before writing", async () => {
    const fixture = await makeWorkspace();
    await expect(
      db.transaction((tx) =>
        appendAudit(tx, {
          ...entry(fixture.workspaceId, randomUUID()),
          outcome: "Granted",
        } as AuditEntry),
      ),
    ).rejects.toThrow();
  });

  it("has no update and no delete path", () => {
    expect(
      Object.keys(journal).filter((name) => /update|delete|remove|purge/i.test(name)),
    ).toEqual([]);
  });
});

describe("actor pseudonymization (VPS-F004 G06)", () => {
  it("replaces only the actor, for the erasure principal, and leaves other people's entries alone", async () => {
    const fixture = await makeWorkspace();
    const erased = randomUUID();
    const other = randomUUID();
    const mine = [
      entry(fixture.workspaceId, erased),
      entry(fixture.workspaceId, erased),
    ];
    const theirs = entry(fixture.workspaceId, other);
    await db.transaction(async (tx) => {
      for (const e of [...mine, theirs]) await appendAudit(tx, e);
    });
    const token = randomUUID();
    const before = await db
      .select()
      .from(auditJournal)
      .where(eq(auditJournal.workspaceId, fixture.workspaceId));
    const result = await db.transaction((tx) =>
      pseudonymizeActor(
        tx,
        { kind: "system", name: "erasure", workspaceId: fixture.workspaceId },
        {
          workspaceId: fixture.workspaceId,
          currentActorUserId: erased,
          opaqueActorToken: token,
        },
      ),
    );
    expect(result.pseudonymizedEntryIds.sort()).toEqual(
      mine.map((e) => e.audit_entry_id).sort(),
    );
    const after = await db
      .select()
      .from(auditJournal)
      .where(eq(auditJournal.workspaceId, fixture.workspaceId));
    for (const row of after) {
      const was = before.find((b) => b.auditEntryId === row.auditEntryId)!;
      if (row.auditEntryId === theirs.audit_entry_id) {
        expect(row).toEqual(was);
      } else {
        expect(row.actorUserId).toBe(token);
        expect(row.entry.actor_user_id).toBe(token);
        expect({ ...row.entry, actor_user_id: "" }).toEqual({
          ...was.entry,
          actor_user_id: "",
        });
        expect(row.contentDigest).not.toBe(was.contentDigest);
      }
    }
  });

  it("is refused for any other system principal and for another workspace", async () => {
    const fixture = await makeWorkspace();
    const request = {
      workspaceId: fixture.workspaceId,
      currentActorUserId: randomUUID(),
      opaqueActorToken: randomUUID(),
    };
    await db.transaction(async (tx) => {
      for (const name of [
        "audience-recompute",
        "retention-sweep",
        "key-rotation",
      ] as const) {
        await expect(
          pseudonymizeActor(
            tx,
            { kind: "system", name, workspaceId: fixture.workspaceId },
            request,
          ),
        ).rejects.toBeInstanceOf(AuditPseudonymizationDeniedError);
      }
      await expect(
        pseudonymizeActor(
          tx,
          { kind: "system", name: "erasure", workspaceId: randomUUID() },
          request,
        ),
      ).rejects.toBeInstanceOf(AuditPseudonymizationDeniedError);
    });
  });
});
