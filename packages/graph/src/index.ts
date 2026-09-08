export {
  createLocalGraphClient,
  GraphWorkerProtocolError,
  type DeltaBatchResult,
  type LocalGraphClient,
  type MutationOutcome,
} from "./client";

export {
  GRAPH_WORKER_PROTOCOL_VERSION,
  graphAvailabilitySchema,
  graphWorkerRequestSchema,
  graphWorkerResponseSchema,
  parseGraphWorkerRequest,
  parseGraphWorkerResponse,
  type GraphAvailability,
  type GraphWorkerError,
  type GraphWorkerRequest,
  type GraphWorkerResponse,
  type GraphWorkerSuccess,
} from "./protocol";

export { graphQuerySchema, parseGraphQuery, type GraphQuery } from "./query";

export {
  decodeMessage,
  encodeMessage,
  WireError,
  MESSAGE_TYPE,
  PROTOCOL_VERSION as SYNC_WIRE_PROTOCOL_VERSION,
  MAX_LP_LEN as SYNC_WIRE_MAX_LP_LEN,
  MAX_BATCH_ENTRIES as SYNC_WIRE_MAX_BATCH_ENTRIES,
  type Message as SyncWireMessage,
  type MessageKind as SyncWireMessageKind,
  type DeltaEntry as SyncWireDeltaEntry,
  type TierTag as SyncWireTierTag,
  type PayloadKind as SyncWirePayloadKind,
  type SyncState as SyncWireState,
  type ErrorKind as SyncWireErrorKind,
} from "./sync/wire";

export { graphSnapshotStoreKey } from "./worker/storage/storage-keys";

export {
  WORKSPACE_GRAPH_DOCUMENT_ID,
  type SyncStatusSnapshot,
  type SyncStatusState,
  type SyncStatusError,
} from "./sync/client";

export {
  createProtectedDocumentAddress,
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedEnvelopeAdditionalData,
  protectedCiphertextKindSchema,
  protectedDocumentAddressSchema,
  protectedEnvelopeHeaderSchema,
  protectedReaderSetSchema,
  PROTECTED_ENVELOPE_FORMAT_VERSION,
  type ProtectedCiphertextKind,
  type ProtectedDocumentAddress,
  type ProtectedEnvelopeHeader,
  type ProtectedReaderSet,
} from "./worker/protected-document";

export type {
  GraphQueryResult,
  MaterializedNeighbor,
  MaterializedNode,
  MaterializedNodeFragment,
  MaterializedRecursiveNeighbor,
} from "./worker/storage/sqlite-graph-index";
