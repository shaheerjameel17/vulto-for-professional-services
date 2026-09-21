/**
 * The SyncStatus observable (A003-T65): `Synced`, `Syncing`, `PendingChanges`,
 * `Offline`, and `NeedsAttention` when a queued mutation was rejected.
 */
export const SYNC_STATUSES = [
  "Synced",
  "Syncing",
  "PendingChanges",
  "Offline",
  "NeedsAttention",
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface SyncStatusInputs {
  /** The last request to the server succeeded. */
  readonly online: boolean;
  /** A shape is still catching up, or an upload is in flight. */
  readonly syncing: boolean;
  readonly pending: number;
  readonly rejected: number;
}

/**
 * A rejection needs the person before anything else. Queued changes are shown as
 * pending even while offline, because that is the fact they can act on; offline
 * without any is simply `Offline`.
 */
export function computeSyncStatus(inputs: SyncStatusInputs): SyncStatus {
  if (inputs.rejected > 0) return "NeedsAttention";
  if (inputs.pending > 0) return "PendingChanges";
  if (!inputs.online) return "Offline";
  if (inputs.syncing) return "Syncing";
  return "Synced";
}

export interface SyncState {
  readonly status: SyncStatus;
  /** Set once the person has signed out or access was revoked; the cache is gone. */
  readonly signedOut: boolean;
  readonly reason?: "signed-out" | "access-revoked";
  /** The rejected mutations awaiting the person, with their reasons. */
  readonly attention: readonly {
    readonly mutationId: string;
    readonly name: string;
    readonly reason: string;
  }[];
}
