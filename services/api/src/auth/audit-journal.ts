import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  auditLogQueryFiltersSchema,
  type AuditLogQueryFilters,
} from "@vulto/graph/audit-log";
import { resolvePermissionDecision } from "@vulto/graph/permission";
import {
  auditEntrySchema,
  deviceApplicationSchema,
  uuidV4Schema,
  type AuditEntry,
} from "@vulto/schema";
import { and, desc, eq, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { db } from "../db.js";
import { env } from "../env.js";
import { parseDeviceId } from "./device-unlock.js";
import { auditJournal, device, deviceUnlockSecret } from "./schema.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
  type CurrentWorkspaceSession,
} from "./workspace-session.js";

const LOCAL_RETENTION_MONTHS = 12;

export class AuditJournalDeniedError extends Error {
  constructor() {
    super("Audit journal access is not available");
  }
}

export class AuditJournalConflictError extends Error {
  constructor() {
    super("The audit entry identifier already has different content");
  }
}

export class AuditJournalCursorError extends Error {
  constructor() {
    super("The audit cursor is not available");
  }
}

export interface AuditAppendRequest {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly entry: AuditEntry;
}

export interface AuditHistoricalQueryRequest {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly localWindowStart: string;
  readonly cursor?: string;
  readonly filters: AuditLogQueryFilters;
}

export interface AuditHistoricalPage {
  readonly entries: readonly AuditEntry[];
  readonly nextCursor?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid request body");
  }
  return value as Record<string, unknown>;
}

export function parseAuditAppendRequest(value: unknown): AuditAppendRequest {
  const input = object(value);
  return {
    workspaceId: uuidV4Schema.parse(input.workspaceId),
    deviceId: parseDeviceId(input.deviceId),
    entry: auditEntrySchema.parse(input.entry),
  };
}

export function parseAuditHistoricalQueryRequest(
  value: unknown,
): AuditHistoricalQueryRequest {
  const input = object(value);
  const localWindowStart = String(input.localWindowStart);
  if (!Number.isFinite(Date.parse(localWindowStart))) {
    throw new Error("Invalid local retention boundary");
  }
  return {
    workspaceId: uuidV4Schema.parse(input.workspaceId),
    deviceId: parseDeviceId(input.deviceId),
    localWindowStart: new Date(localWindowStart).toISOString(),
    ...(input.cursor === undefined ? {} : { cursor: String(input.cursor) }),
    filters: auditLogQueryFiltersSchema.parse(input.filters ?? {}),
  };
}

export async function requireAuditDeviceContext(
  headers: Headers,
  workspaceId: string,
  deviceId: string,
): Promise<{
  session: CurrentWorkspaceSession;
  application: AuditEntry["actor_application"];
}> {
  let current: CurrentWorkspaceSession;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new AuditJournalDeniedError();
    }
    throw error;
  }

  const [registered] = await db
    .select({
      userId: device.userId,
      application: device.application,
      isRevoked: device.isRevoked,
      unlockUserId: deviceUnlockSecret.userId,
      unlockRevokedAt: deviceUnlockSecret.revokedAt,
    })
    .from(device)
    .innerJoin(
      deviceUnlockSecret,
      and(
        eq(deviceUnlockSecret.deviceId, device.id),
        eq(deviceUnlockSecret.workspaceId, current.workspaceId),
      ),
    )
    .where(and(eq(device.id, deviceId), eq(device.userId, current.userId)))
    .limit(1);

  if (
    !registered ||
    registered.isRevoked ||
    registered.unlockRevokedAt !== null ||
    registered.unlockUserId !== current.userId
  ) {
    throw new AuditJournalDeniedError();
  }

  return {
    session: current,
    application: deviceApplicationSchema.parse(registered.application),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalAuditEntryContent(entry: AuditEntry): string {
  return canonicalJson(auditEntrySchema.parse(entry));
}

export function auditContentDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("base64url");
}

function indexedTarget(entry: AuditEntry): {
  targetNodeType: string | null;
  targetTier: number | null;
} {
  if (entry.target.kind === "NodeTarget") {
    return {
      targetNodeType: entry.target.node_type,
      targetTier: entry.target.target_tier,
    };
  }
  if (entry.target.kind === "QueryTarget") {
    return {
      targetNodeType: entry.target.requested_node_type,
      targetTier: entry.target.target_tier,
    };
  }
  return { targetNodeType: null, targetTier: entry.target.target_tier };
}

export async function appendAuditEntry(
  headers: Headers,
  request: AuditAppendRequest,
): Promise<{ appended: boolean }> {
  const context = await requireAuditDeviceContext(
    headers,
    request.workspaceId,
    request.deviceId,
  );
  const entry = auditEntrySchema.parse(request.entry);
  if (
    entry.workspace_id !== context.session.workspaceId ||
    entry.actor_user_id !== context.session.userId ||
    entry.actor_membership_id !== context.session.membershipId ||
    entry.actor_application !== context.application
  ) {
    throw new AuditJournalDeniedError();
  }

  const content = canonicalAuditEntryContent(entry);
  const contentDigest = auditContentDigest(content);
  const target = indexedTarget(entry);
  return db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(auditJournal)
      .values({
        workspaceId: context.session.workspaceId,
        auditEntryId: entry.audit_entry_id,
        contentDigest,
        entry,
        occurredAt: new Date(entry.occurred_at),
        actorUserId: context.session.userId,
        eventType: entry.event_type,
        operation: entry.operation,
        outcome: entry.outcome,
        targetKind: entry.target.kind,
        targetNodeType: target.targetNodeType,
        targetTier: target.targetTier,
      })
      .onConflictDoNothing()
      .returning({ auditEntryId: auditJournal.auditEntryId });
    if (inserted.length > 0) return { appended: true };

    const [existing] = await transaction
      .select({ contentDigest: auditJournal.contentDigest })
      .from(auditJournal)
      .where(
        and(
          eq(auditJournal.workspaceId, context.session.workspaceId),
          eq(auditJournal.auditEntryId, entry.audit_entry_id),
        ),
      )
      .limit(1);
    if (!existing || existing.contentDigest !== contentDigest) {
      throw new AuditJournalConflictError();
    }
    return { appended: false };
  });
}

function queryFingerprint(filters: AuditLogQueryFilters, boundary: string): string {
  const parsed = auditLogQueryFiltersSchema.parse(filters);
  return auditContentDigest(
    JSON.stringify({
      boundary,
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
      actorUserId: parsed.actorUserId ?? null,
      eventType: parsed.eventType ?? null,
      operation: parsed.operation ?? null,
      outcome: parsed.outcome ?? null,
      targetNodeType: parsed.targetNodeType ?? null,
      targetTier: parsed.targetTier ?? null,
    }),
  );
}

interface ServerCursorPayload {
  readonly version: 1;
  readonly workspaceId: string;
  readonly fingerprint: string;
  readonly afterOccurredAt: string;
  readonly afterAuditEntryId: string;
}

function signCursor(payload: ServerCursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(encoded, "utf8")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function openCursor(cursor: string): ServerCursorPayload {
  const [encoded, suppliedSignature, ...rest] = cursor.split(".");
  if (!encoded || !suppliedSignature || rest.length > 0) {
    throw new AuditJournalCursorError();
  }
  const expected = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(encoded, "utf8")
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    throw new AuditJournalCursorError();
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new AuditJournalCursorError();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new AuditJournalCursorError();
  }
  const value = object(payload);
  if (
    value.version !== 1 ||
    typeof value.workspaceId !== "string" ||
    typeof value.fingerprint !== "string" ||
    typeof value.afterOccurredAt !== "string" ||
    typeof value.afterAuditEntryId !== "string"
  ) {
    throw new AuditJournalCursorError();
  }
  return {
    version: 1,
    workspaceId: value.workspaceId,
    fingerprint: value.fingerprint,
    afterOccurredAt: value.afterOccurredAt,
    afterAuditEntryId: uuidV4Schema.parse(value.afterAuditEntryId),
  };
}

function localWindowFloor(now: Date): Date {
  const floor = new Date(now);
  floor.setUTCMonth(floor.getUTCMonth() - LOCAL_RETENTION_MONTHS);
  return floor;
}

export async function queryHistoricalAudit(
  headers: Headers,
  request: AuditHistoricalQueryRequest,
): Promise<AuditHistoricalPage> {
  const context = await requireAuditDeviceContext(
    headers,
    request.workspaceId,
    request.deviceId,
  );
  if (
    resolvePermissionDecision(context.session.roles, "AuditEntry", "record").outcome !==
    "full"
  ) {
    throw new AuditJournalDeniedError();
  }

  const filters = auditLogQueryFiltersSchema.parse(request.filters);
  const requestedBoundary = new Date(request.localWindowStart);
  const earliestAllowedBoundary = localWindowFloor(new Date(Date.now() - 60_000));
  const latestAllowedBoundary = localWindowFloor(new Date(Date.now() + 60_000));
  if (
    requestedBoundary < earliestAllowedBoundary ||
    requestedBoundary > latestAllowedBoundary
  ) {
    throw new AuditJournalCursorError();
  }
  const boundary = requestedBoundary.toISOString();
  const fingerprint = queryFingerprint(filters, boundary);
  const conditions: SQL[] = [
    eq(auditJournal.workspaceId, context.session.workspaceId),
    lt(auditJournal.occurredAt, requestedBoundary),
  ];
  if (filters.startDate !== undefined) {
    conditions.push(gte(auditJournal.occurredAt, new Date(filters.startDate)));
  }
  if (filters.endDate !== undefined) {
    conditions.push(lte(auditJournal.occurredAt, new Date(filters.endDate)));
  }
  if (filters.actorUserId !== undefined) {
    conditions.push(eq(auditJournal.actorUserId, filters.actorUserId));
  }
  if (filters.eventType !== undefined) {
    conditions.push(eq(auditJournal.eventType, filters.eventType));
  }
  if (filters.operation !== undefined) {
    conditions.push(eq(auditJournal.operation, filters.operation));
  }
  if (filters.outcome !== undefined) {
    conditions.push(eq(auditJournal.outcome, filters.outcome));
  }
  if (filters.targetNodeType !== undefined) {
    conditions.push(eq(auditJournal.targetNodeType, filters.targetNodeType));
  }
  if (filters.targetTier !== undefined) {
    conditions.push(eq(auditJournal.targetTier, filters.targetTier));
  }

  if (request.cursor !== undefined) {
    const cursor = openCursor(request.cursor);
    if (
      cursor.workspaceId !== context.session.workspaceId ||
      cursor.fingerprint !== fingerprint
    ) {
      throw new AuditJournalCursorError();
    }
    const occurredAt = new Date(cursor.afterOccurredAt);
    if (!Number.isFinite(occurredAt.getTime())) throw new AuditJournalCursorError();
    conditions.push(
      or(
        lt(auditJournal.occurredAt, occurredAt),
        and(
          eq(auditJournal.occurredAt, occurredAt),
          lt(auditJournal.auditEntryId, cursor.afterAuditEntryId),
        ),
      )!,
    );
  }

  const rows = await db
    .select({ entry: auditJournal.entry })
    .from(auditJournal)
    .where(and(...conditions))
    .orderBy(desc(auditJournal.occurredAt), desc(auditJournal.auditEntryId))
    .limit(filters.limit + 1);
  const hasNext = rows.length > filters.limit;
  const entries = rows
    .slice(0, filters.limit)
    .map((row) => auditEntrySchema.parse(row.entry));
  const last = entries.at(-1);
  return {
    entries,
    ...(hasNext && last
      ? {
          nextCursor: signCursor({
            version: 1,
            workspaceId: context.session.workspaceId,
            fingerprint,
            afterOccurredAt: last.occurred_at,
            afterAuditEntryId: last.audit_entry_id,
          }),
        }
      : {}),
  };
}
