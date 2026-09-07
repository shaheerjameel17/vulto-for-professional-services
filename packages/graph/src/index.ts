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

export { graphSnapshotStoreKey } from "./worker/storage/storage-keys";

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
