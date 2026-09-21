export {
  createGraphClient,
  type GraphClient,
  type GraphClientOptions,
  type SyncStatusHandle,
} from "./client";
export {
  SYNC_STATUSES,
  computeSyncStatus,
  type SyncState,
  type SyncStatus,
} from "./status";
export type {
  MutateOutcome,
  ProtectedAvailability,
  ProtectedReadOutcome,
  QueryAvailability,
  QueryOutcome,
} from "./engine";
export type { CacheEdge, CacheNeighbor, CacheNode, CacheQueryResult } from "./query";
export type { ProtectedItem } from "./protected-store";
