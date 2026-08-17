/** Canonical VPS-A002 graph contracts. No runtime mutation API is exposed. */
import "./registry/validate.js";

export {
  NODE_REGISTRY,
  NODE_TYPES,
  getNodeRegistration,
  isAnonymityProtectedNodeType,
  isNodeType,
  type NodeRegistration,
  type NodeType,
} from "./registry/nodes.js";

export {
  CUSTOM_FIELD_ENABLED_NODE,
  EDGE_REGISTRY,
  EDGE_SOURCE_ROW_COUNT,
  EDGE_TYPES,
  ENDPOINT_SETS,
  IMPORTABLE_NODE,
  MENTIONABLE_NODE,
  NON_ANONYMOUS_NODE,
  assertRegisteredRelationship,
  getEdgeRegistrations,
  type EdgeRegistration,
  type EdgeType,
  type EndpointSet,
  type RegistryEndpoint,
} from "./registry/edges.js";

export {
  ANONYMITY_REGISTRY,
  type AllowedAnonymousRelationship,
  type AnonymityRegistration,
} from "./registry/anonymity.js";

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
