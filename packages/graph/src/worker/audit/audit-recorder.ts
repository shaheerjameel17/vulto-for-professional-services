import {
  auditEntrySchema,
  type AuditEntry,
  type AuditEventType,
  type AuditMetadata,
  type AuditOperation,
  type AuditTargetReference,
} from "@vulto/schema";
import { z } from "zod";
import {
  auditLogQueryFiltersSchema,
  type AuditLogQueryFilters,
  type AuditLogQueryResult,
} from "../../audit-log";
import type { PermissionDecision } from "../permission/policy-table";
import { SealedStore, type AuthenticatedWorkerContext } from "../storage/sealed-store";

export interface AuditLocalState {
  readonly formatVersion: 1;
  readonly journal: readonly AuditEntry[];
  readonly outbox: readonly AuditEntry[];
}

export interface AuditRecordRequest {
  readonly eventType: AuditEventType;
  readonly operation: AuditOperation;
  readonly target: AuditTargetReference;
  readonly metadata: AuditMetadata;
  readonly decision: PermissionDecision;
}

export interface AuditRecordIdentity {
  readonly auditEntryId: string;
  readonly occurredAt: string;
}

export interface AuditAppendMeasurement {
  readonly auditEntryId: string;
  readonly durationMs: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AUDIT_LOCAL_RETENTION_MONTHS = 12;
const PRIVILEGED_PROJECTION_AUDIT_PREFIX = "vulto:audit:privileged-projection:v1";

function bytesToUuidV4(bytes: Uint8Array): string {
  const uuidBytes = bytes.slice(0, 16);
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
  const hex = [...uuidBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function privilegedProjectionAuditIdentity(input: {
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly projectionKind: "Admission" | "RoleChange" | "Revocation";
  readonly occurredAt: string;
}): Promise<AuditRecordIdentity> {
  const occurredAt = new Date(input.occurredAt).toISOString();
  const seed = [
    PRIVILEGED_PROJECTION_AUDIT_PREFIX,
    input.workspaceId,
    input.membershipId,
    input.projectionKind,
    occurredAt,
  ].join("\u001f");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(seed) as BufferSource),
  );
  return { auditEntryId: bytesToUuidV4(digest), occurredAt };
}

const auditCursorPayloadSchema = z.discriminatedUnion("source", [
  z
    .object({
      formatVersion: z.literal(1),
      source: z.literal("Local"),
      workspaceId: z.string().min(1),
      filterFingerprint: z.string().length(43),
      afterOccurredAt: z.string().min(1),
      afterAuditEntryId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      formatVersion: z.literal(1),
      source: z.literal("Historical"),
      workspaceId: z.string().min(1),
      filterFingerprint: z.string().length(43),
      localWindowStart: z.string().min(1),
      serverCursor: z.string().min(1).nullable(),
    })
    .strict(),
]);

export interface AuditHistoricalFetchRequest {
  readonly filters: AuditLogQueryFilters;
  readonly localWindowStart: string;
  readonly serverCursor?: string;
}

export interface AuditHistoricalFetchResult {
  readonly entries: readonly AuditEntry[];
  readonly nextCursor?: string;
}

export type AuditHistoricalFetcher = (
  request: AuditHistoricalFetchRequest,
) => Promise<AuditHistoricalFetchResult>;

function parseEntry(bytes: Uint8Array): AuditEntry {
  return auditEntrySchema.parse(JSON.parse(decoder.decode(bytes)));
}

export function auditLocalWindowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - AUDIT_LOCAL_RETENTION_MONTHS);
  return start;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function filterFingerprint(
  filters: ReturnType<typeof auditLogQueryFiltersSchema.parse>,
): Promise<string> {
  const canonicalFilters = JSON.stringify({
    startDate: filters.startDate ?? null,
    endDate: filters.endDate ?? null,
    actorUserId: filters.actorUserId ?? null,
    eventType: filters.eventType ?? null,
    operation: filters.operation ?? null,
    outcome: filters.outcome ?? null,
    targetNodeType: filters.targetNodeType ?? null,
    targetTier: filters.targetTier ?? null,
  });
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(canonicalFilters) as BufferSource,
      ),
    ),
  );
}

function matchesFilters(
  entry: AuditEntry,
  filters: ReturnType<typeof auditLogQueryFiltersSchema.parse>,
): boolean {
  if (
    filters.startDate !== undefined &&
    Date.parse(entry.occurred_at) < Date.parse(filters.startDate)
  ) {
    return false;
  }
  if (
    filters.endDate !== undefined &&
    Date.parse(entry.occurred_at) > Date.parse(filters.endDate)
  ) {
    return false;
  }
  if (
    (filters.actorUserId !== undefined &&
      entry.actor_user_id !== filters.actorUserId) ||
    (filters.eventType !== undefined && entry.event_type !== filters.eventType) ||
    (filters.operation !== undefined && entry.operation !== filters.operation) ||
    (filters.outcome !== undefined && entry.outcome !== filters.outcome) ||
    (filters.targetTier !== undefined &&
      entry.target.target_tier !== filters.targetTier)
  ) {
    return false;
  }
  if (filters.targetNodeType === undefined) return true;
  return (
    (entry.target.kind === "NodeTarget" &&
      entry.target.node_type === filters.targetNodeType) ||
    (entry.target.kind === "QueryTarget" &&
      entry.target.requested_node_type === filters.targetNodeType)
  );
}

/**
 * FDN-68's single internal audit writer. Its surface is append-only: there
 * is no replacement, update, or removal operation. Journal and outbox are
 * committed in one real sealed-store IndexedDB transaction.
 */
export class AuditRecorder {
  #failed = false;
  #lastAppendMeasurement: AuditAppendMeasurement | null = null;

  constructor(
    private readonly sealedStore: SealedStore,
    private readonly workspaceId: string,
    private readonly actorContext: () => AuthenticatedWorkerContext,
    private readonly onLocalAppend?: () => void,
  ) {}

  get failed(): boolean {
    return this.#failed;
  }

  get lastAppendMeasurement(): AuditAppendMeasurement | null {
    return this.#lastAppendMeasurement;
  }

  async record(
    request: AuditRecordRequest,
    identity?: AuditRecordIdentity,
  ): Promise<AuditEntry> {
    if (
      identity !== undefined &&
      request.eventType !== "PrivilegedProjectionAuthorized"
    ) {
      throw new Error(
        "A caller-supplied audit identity is reserved for privileged projections",
      );
    }
    if (identity !== undefined) {
      const existingBytes = await this.sealedStore.readAuditEntry(
        identity.auditEntryId,
      );
      if (existingBytes !== null) {
        const existing = parseEntry(existingBytes);
        const occurredAt = new Date(identity.occurredAt).toISOString();
        const projectionMatches =
          existing.workspace_id === this.workspaceId &&
          existing.event_type === request.eventType &&
          existing.operation === request.operation &&
          existing.occurred_at === occurredAt &&
          JSON.stringify(existing.target) === JSON.stringify(request.target) &&
          existing.metadata.authorization_path ===
            request.metadata.authorization_path &&
          existing.metadata.projection_kind === request.metadata.projection_kind;
        if (!projectionMatches) {
          this.#failed = true;
          throw new Error("An audit_entry_id cannot be reused with different content");
        }
        return existing;
      }
    }
    const actor = this.actorContext();
    if (actor.workspaceId !== this.workspaceId) {
      this.#failed = true;
      throw new Error("Audit actor workspace does not match the journal workspace");
    }
    const outcome =
      request.eventType === "PermissionDenied"
        ? "Denied"
        : request.eventType === "AuthorizedOperationFailed"
          ? "Failed"
          : "Granted";
    const entry = auditEntrySchema.parse({
      audit_entry_id: identity?.auditEntryId ?? crypto.randomUUID(),
      schema_version: 1,
      workspace_id: this.workspaceId,
      event_type: request.eventType,
      operation: request.operation,
      outcome,
      actor_user_id: actor.userId,
      actor_membership_id: actor.membershipId,
      actor_role:
        request.eventType === "PermissionDenied" ||
        request.eventType === "PrivilegedProjectionAuthorized"
          ? null
          : request.decision.decidingRole,
      actor_roles: request.decision.rolesSnapshot,
      actor_application: actor.application,
      target: request.target,
      metadata: request.metadata,
      occurred_at:
        identity === undefined
          ? new Date().toISOString()
          : new Date(identity.occurredAt).toISOString(),
    });
    await this.append(entry);
    return entry;
  }

  /** Identical replay is a no-op; identifier reuse with different content fails. */
  async append(entryInput: AuditEntry): Promise<void> {
    if (this.#failed) throw new Error("The audit recorder has failed closed");
    const entry = auditEntrySchema.parse(entryInput);
    if (entry.workspace_id !== this.workspaceId) {
      this.#failed = true;
      throw new Error("Audit entry workspace does not match the journal workspace");
    }
    const startedAt = performance.now();
    try {
      await this.sealedStore.appendAuditEntry(
        entry.audit_entry_id,
        encoder.encode(JSON.stringify(entry)),
      );
      this.#lastAppendMeasurement = {
        auditEntryId: entry.audit_entry_id,
        durationMs: performance.now() - startedAt,
      };
      this.onLocalAppend?.();
    } catch (error) {
      this.#failed = true;
      throw error;
    }
  }

  /** Reads a fresh sealed snapshot; no in-memory journal can mask reopen bugs. */
  async snapshotForDiagnostics(): Promise<AuditLocalState> {
    const [journal, outbox] = await Promise.all([
      this.sealedStore.readAuditEntries("journal"),
      this.sealedStore.readAuditEntries("outbox"),
    ]);
    return {
      formatVersion: 1,
      journal: journal.map(parseEntry),
      outbox: outbox.map(parseEntry),
    };
  }

  /**
   * Reads the local retention projection first, then crosses into the retained
   * server journal through a caller-supplied authenticated fetcher. Every
   * public cursor remains sealed by this workspace key; Historical cursors
   * additionally contain the server's own signed cursor as opaque data.
   */
  async query(
    filtersInput: AuditLogQueryFilters = {},
    fetchHistorical?: AuditHistoricalFetcher,
  ): Promise<AuditLogQueryResult> {
    const filters = auditLogQueryFiltersSchema.parse(filtersInput);
    const windowStart = auditLocalWindowStart(new Date());
    const availableFrom = windowStart.toISOString();
    const fingerprint = await filterFingerprint(filters);
    let cursor: z.infer<typeof auditCursorPayloadSchema> | null = null;
    if (filters.cursor !== undefined) {
      const opened = await this.sealedStore.openAuditCursor(filters.cursor);
      if (opened !== null) {
        try {
          const parsed = auditCursorPayloadSchema.safeParse(
            JSON.parse(decoder.decode(opened)),
          );
          if (parsed.success) cursor = parsed.data;
        } catch {
          // Authenticated plaintext from a future format is unavailable here.
        }
      }
      if (
        cursor === null ||
        cursor.workspaceId !== this.workspaceId ||
        cursor.filterFingerprint !== fingerprint
      ) {
        return {
          kind: "audit-log-retention-window-unavailable",
          availableFrom,
        };
      }
    }

    const historicalFilters: AuditLogQueryFilters = {
      limit: filters.limit,
      ...(filters.startDate === undefined ? {} : { startDate: filters.startDate }),
      ...(filters.endDate === undefined ? {} : { endDate: filters.endDate }),
      ...(filters.actorUserId === undefined
        ? {}
        : { actorUserId: filters.actorUserId }),
      ...(filters.eventType === undefined ? {} : { eventType: filters.eventType }),
      ...(filters.operation === undefined ? {} : { operation: filters.operation }),
      ...(filters.outcome === undefined ? {} : { outcome: filters.outcome }),
      ...(filters.targetNodeType === undefined
        ? {}
        : { targetNodeType: filters.targetNodeType }),
      ...(filters.targetTier === undefined ? {} : { targetTier: filters.targetTier }),
    };
    const fetchHistoricalPage = async (
      serverCursor?: string,
      historicalWindowStart = availableFrom,
    ): Promise<AuditLogQueryResult> => {
      if (fetchHistorical === undefined) {
        return {
          kind: "audit-log-retention-window-unavailable",
          availableFrom,
        };
      }
      const historical = await fetchHistorical({
        filters: historicalFilters,
        localWindowStart: historicalWindowStart,
        ...(serverCursor === undefined ? {} : { serverCursor }),
      });
      const nextCursor =
        historical.nextCursor === undefined
          ? undefined
          : await this.sealedStore.sealAuditCursor(
              encoder.encode(
                JSON.stringify({
                  formatVersion: 1,
                  source: "Historical",
                  workspaceId: this.workspaceId,
                  filterFingerprint: fingerprint,
                  localWindowStart: historicalWindowStart,
                  serverCursor: historical.nextCursor,
                }),
              ),
            );
      return {
        kind: "audit-log-page",
        entries: [...historical.entries],
        ...(nextCursor === undefined ? {} : { nextCursor }),
        source: "Historical",
      };
    };

    if (cursor?.source === "Historical") {
      return fetchHistoricalPage(
        cursor.serverCursor ?? undefined,
        cursor.localWindowStart,
      );
    }

    const whollyHistorical =
      filters.endDate !== undefined &&
      Date.parse(filters.endDate) < windowStart.getTime();
    if (whollyHistorical) return fetchHistoricalPage();

    const entries = (await this.sealedStore.readAuditEntries("journal"))
      .map(parseEntry)
      .filter((entry) => Date.parse(entry.occurred_at) >= windowStart.getTime())
      .filter((entry) => matchesFilters(entry, filters))
      .sort(
        (left, right) =>
          right.occurred_at.localeCompare(left.occurred_at) ||
          right.audit_entry_id.localeCompare(left.audit_entry_id),
      );

    let startIndex = 0;
    if (cursor?.source === "Local") {
      const anchorIndex = entries.findIndex(
        (entry) =>
          entry.occurred_at === cursor.afterOccurredAt &&
          entry.audit_entry_id === cursor.afterAuditEntryId,
      );
      if (anchorIndex < 0) {
        return {
          kind: "audit-log-retention-window-unavailable",
          availableFrom,
        };
      }
      startIndex = anchorIndex + 1;
    }

    const page = entries.slice(startIndex, startIndex + filters.limit);
    const last = page.at(-1);
    const hasNextPage = startIndex + page.length < entries.length;
    const canContainHistory =
      filters.startDate === undefined ||
      Date.parse(filters.startDate) < windowStart.getTime();
    if (page.length === 0 && !hasNextPage && canContainHistory) {
      return fetchHistoricalPage();
    }
    const nextCursor = await (async () => {
      if (hasNextPage && last !== undefined) {
        return this.sealedStore.sealAuditCursor(
          encoder.encode(
            JSON.stringify({
              formatVersion: 1,
              source: "Local",
              workspaceId: this.workspaceId,
              filterFingerprint: fingerprint,
              afterOccurredAt: last.occurred_at,
              afterAuditEntryId: last.audit_entry_id,
            }),
          ),
        );
      }
      if (canContainHistory && fetchHistorical !== undefined) {
        return this.sealedStore.sealAuditCursor(
          encoder.encode(
            JSON.stringify({
              formatVersion: 1,
              source: "Historical",
              workspaceId: this.workspaceId,
              filterFingerprint: fingerprint,
              localWindowStart: availableFrom,
              serverCursor: null,
            }),
          ),
        );
      }
      return undefined;
    })();
    return {
      kind: "audit-log-page",
      entries: page,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      source: "Local",
    };
  }
}
