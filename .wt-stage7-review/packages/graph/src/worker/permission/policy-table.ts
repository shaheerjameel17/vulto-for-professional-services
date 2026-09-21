// F199 (Stage 3): the policy table now lives in `@vulto/schema` (A004-T21).
// This shim keeps the retired device Worker compiling until Stage 7 deletes it.
export {
  POLICY_ROLES,
  resolvePermission,
  type PermissionOutcome,
  type PolicyResolution,
  type PolicyRole,
  type PolicyScope,
} from "@vulto/schema";
