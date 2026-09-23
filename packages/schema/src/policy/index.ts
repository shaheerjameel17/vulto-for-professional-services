/** VPS-A004's policy table — the sole input to the interceptor (A004-T21). */
export {
  POLICY_ROLES,
  resolvePermission,
  resolvePolicyCell,
  type PermissionOutcome,
  type PolicyCellResolution,
  type PolicyResolution,
  type PolicyRole,
  type PolicyScope,
} from "./policy-table";
export { deriveEffectiveRoles } from "./effective-roles";
export {
  MATRIX_COVERAGE_BASELINE,
  countMatrixCoverage,
  enumerateMatrixCells,
} from "./matrix-coverage";
export {
  SYSTEM_OPERATIONS,
  SYSTEM_PRINCIPAL_NAMES,
  SYSTEM_PRINCIPAL_OPERATIONS,
  isSystemOperationPermitted,
  type SystemOperation,
  type SystemPrincipalName,
} from "./principal-policy";
export {
  ERASURE_DOMAIN_OVERRIDES,
  SUBJECT_EXCLUSIONS,
  getSubjectExclusion,
} from "./subject-exclusion";
export {
  K_ANONYMITY_FLOOR,
  K_ANONYMITY_MINIMUM_DEFAULT,
  K_ANONYMITY_MINIMUM_SENSITIVE_DEFAULT,
  applyDisclosureControl,
  readKAnonymityThreshold,
  type DisclosureControlResult,
} from "./disclosure-control";
