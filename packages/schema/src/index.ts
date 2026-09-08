/** Canonical VPS-A002 graph contracts. No runtime mutation API is exposed. */
import "./registry/validate";

export {
  NODE_REGISTRY,
  NODE_TYPES,
  getNodeRegistration,
  isAnonymityProtectedNodeType,
  isNodeType,
  type NodeRegistration,
  type NodeType,
} from "./registry/nodes";

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
} from "./registry/edges";

export {
  ANONYMITY_REGISTRY,
  type AllowedAnonymousRelationship,
  type AnonymityRegistration,
} from "./registry/anonymity";

export {
  PRIVACY_CLASSES,
  type DataTier,
  type LifecyclePolicy,
  type PrivacyClass,
  type ProtectionPartition,
  type ProtectionPolicy,
  type UniversalFieldPolicy,
} from "./registry/types";

export {
  OWNERSHIP_REGISTRY,
  getOwnershipRegistration,
  type OwnershipMode,
  type OwnershipRegistration,
} from "./registry/ownership";

export {
  CONVERSION_REGISTRY,
  type ConversionRegistration,
} from "./registry/conversions";

export {
  DEFAULT_PRIVACY_CLASS_TIERS,
  getProtectionPartitions,
  resolveInheritedTier,
  resolvePrivacyClassDefaultTier,
  resolveRegisteredProtectionTier,
} from "./registry/protection";

export {
  GRAPH_DOCUMENT_SCHEMA_GENERATION,
  MINIMUM_READABLE_GRAPH_DOCUMENT_SCHEMA_GENERATION,
  isReadableGraphDocumentSchemaGeneration,
} from "./document-generation";

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
} from "./records";

export {
  DEVICE_APPLICATIONS,
  DEVICE_PLATFORMS,
  DEVICE_TRUST_EVENT_TYPES,
  MEMBERSHIP_PROJECTION_STATES,
  USER_STATUSES,
  WORKSPACE_MEMBERSHIP_STATUSES,
  WORKSPACE_ROLES,
  WORKSPACE_STATUSES,
  deviceApplicationSchema,
  deviceIdSchema,
  devicePlatformSchema,
  deviceRegistrationInputSchema,
  deviceTrustEventTypeSchema,
  membershipProjectionStateSchema,
  passkeyRegistrationInputSchema,
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  userStatusSchema,
  workspaceMembershipStatusSchema,
  workspaceRoleSchema,
  workspaceStatusSchema,
  type DeviceApplication,
  type DeviceId,
  type DevicePlatform,
  type DeviceRegistrationInput,
  type DeviceTrustEventType,
  type MembershipProjectionState,
  type PasskeyRegistrationInput,
  type UserStatus,
  type WorkspaceMembershipStatus,
  type WorkspaceRole,
  type WorkspaceStatus,
} from "./auth";
