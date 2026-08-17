/** Canonical VPS-A002 graph contracts. No runtime mutation API is exposed. */
import "./registry/validate.js";

export {
  NODE_REGISTRY,
  NODE_TYPES,
  getNodeRegistration,
  isNodeType,
  type NodeRegistration,
  type NodeType,
} from "./registry/nodes.js";

export {
  ANY_NODE,
  EDGE_REGISTRY,
  EDGE_SOURCE_ROW_COUNT,
  EDGE_TYPES,
  assertRegisteredRelationship,
  getEdgeRegistrations,
  type EdgeRegistration,
  type EdgeType,
  type RegistryEndpoint,
} from "./registry/edges.js";

export {
  PRIVACY_CLASSES,
  type DataTier,
  type LifecyclePolicy,
  type PrivacyClass,
  type ProtectionPartition,
  type ProtectionPolicy,
  type UniversalFieldPolicy,
} from "./registry/types.js";

export {
  OWNERSHIP_REGISTRY,
  getOwnershipRegistration,
  type OwnershipMode,
  type OwnershipRegistration,
} from "./registry/ownership.js";

export {
  CONVERSION_REGISTRY,
  type ConversionRegistration,
} from "./registry/conversions.js";

export {
  getProtectionPartitions,
  resolveInheritedTier,
} from "./registry/protection.js";

export {
  edgeRecordSchema,
  edgeTypeSchema,
  jsonValueSchema,
  nodeRecordSchema,
  nodeTypeSchema,
  parseEdgeRecord,
  parseNodeRecord,
  utcTimestampSchema,
  uuidV4Schema,
  type EdgeRecord,
  type JsonValue,
  type NodeRecord,
  type WireEdgeType,
  type WireNodeType,
} from "./records.js";
