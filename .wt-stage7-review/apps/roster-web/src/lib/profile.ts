import { EMPLOYEES, type Employee } from "../fixtures/roster";
import { profileFor, type ProfileDetail } from "../fixtures/profiles";
import { ENTITY_NAMES } from "../fixtures/calendar";

/*
 * VRS-F002's structural-absence rule, applied.
 *
 * "Tier 1 fields absent entirely for an unauthorized caller, per VPS-A004's
 * structural-absence rule — never null, never redacted." That is a statement
 * about what this function returns, not about what the component decides to
 * render. `compensation` is added to the returned object with a conditional
 * spread rather than a conditional value, so an unauthorized view-model has
 * no `compensation` key at all — not a key holding `undefined`, which a
 * careless `JSON.stringify` or a future field added beside it could still
 * leak the shape of.
 */

export type EmployeeProfile = Omit<ProfileDetail, "compensation"> & {
  fullName: string;
  jobTitle: string;
  entityName: string;
  compensation?: ProfileDetail["compensation"];
};

export function buildEmployeeProfile(
  employeeId: string,
  canSeeCompensation: boolean,
): EmployeeProfile | undefined {
  const employee = EMPLOYEES.find((e) => e.employeeId === employeeId);
  const detail = profileFor(employeeId);
  if (!employee || !detail) return undefined;

  const { compensation, ...rest } = detail;

  return {
    ...rest,
    fullName: employee.fullName,
    jobTitle: employee.jobTitle,
    entityName: ENTITY_NAMES[employee.entityId],
    // The conditional spread, not a conditional value. See the note above.
    ...(canSeeCompensation ? { compensation } : {}),
  };
}

export function employeeSummary(employeeId: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.employeeId === employeeId);
}
