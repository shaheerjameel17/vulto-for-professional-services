/**
 * VPS-A004 "Principals that are not members" — the policy rows for system
 * principals (A004-T22).
 *
 * A system principal is a named identity for a system job. Its permitted
 * operations are listed here and nowhere else; an operation not listed for the
 * name is refused. Operations are added, with the stage that builds the job,
 * only when the code that performs them exists, so this table never promises
 * an operation nothing implements.
 */
export const SYSTEM_PRINCIPAL_NAMES = [
  "audience-recompute",
  "retention-sweep",
  "erasure",
  "key-rotation",
] as const;

export type SystemPrincipalName = (typeof SYSTEM_PRINCIPAL_NAMES)[number];

export const SYSTEM_OPERATIONS = [
  "audit.pseudonymize-actor",
  "protected.destroy-key",
  "audience.recompute",
] as const;

export type SystemOperation = (typeof SYSTEM_OPERATIONS)[number];

export const SYSTEM_PRINCIPAL_OPERATIONS: Readonly<
  Record<SystemPrincipalName, readonly SystemOperation[]>
> = {
  // Keeping each person's sync audience equal to what the interceptor permits
  // (A003-T57). It decides with the side-effect-free `decide*` functions and
  // writes only the two audience tables.
  "audience-recompute": ["audience.recompute"],
  "retention-sweep": [],
  // VPS-F004 G06: actor pseudonymization on erasure is the one narrow
  // in-place change the audit journal permits.
  // Destroying a Tier 1 erasure domain's data key is cryptographic erasure
  // (A003-T62). Key rotation has no operation yet: its job is not built.
  erasure: ["audit.pseudonymize-actor", "protected.destroy-key"],
  "key-rotation": [],
};

export function isSystemOperationPermitted(
  name: SystemPrincipalName,
  operation: SystemOperation,
): boolean {
  return SYSTEM_PRINCIPAL_OPERATIONS[name].includes(operation);
}
