import { EMPLOYEES, type Employee } from "../fixtures/roster";
import { profileFor } from "../fixtures/profiles";

/*
 * The prototype's viewer — scaffolding, and the only one of its kind.
 *
 * Three screens let you switch role so that a permission-dependent render can
 * be compared against its alternative side by side: the Bench Forecast's
 * compensation boundary, Home's role-aware composition, and the employee
 * profile's structurally-absent compensation Section. None of this is a
 * permission system; VPS-A004 owns that and it does not exist here.
 *
 * It lives in one module because it was previously declared in three, each
 * with its own `ViewerRole` type meaning something different — `owner |
 * manager` on one screen, `owner | manager | member` on another, and
 * `hr-admin | team-member` on a third — and the same person's name under two
 * different constant names. Three types sharing one name and disagreeing is
 * the kind of thing that is obvious while you are writing the third one and
 * invisible six months later.
 *
 * The role vocabulary is VPS-D004's role matrix. A screen narrows it to the
 * roles whose difference that screen actually demonstrates, rather than
 * inventing its own words for the same people.
 */

/** VPS-D004's roles. A screen uses the subset it can actually show a
 * difference between; it does not invent new names for these. */
export type ViewerRole = "owner" | "hr-admin" | "manager" | "member";

/**
 * The person the prototype renders as wherever a role is person-scoped.
 *
 * Omar Farooq manages six people and is himself managed by Tom Beckett, which
 * is the ordinary case in a firm this size — almost everyone is both. Using one
 * identity for the Manager and Member views is what makes the distinction
 * visible: not who you are, but which of your two relationships to the
 * workspace a screen is answering. He is also the person the timesheet renders,
 * so Home's Member view and Timesheets agree about whose week it is.
 */
export const VIEWER_NAME = "Omar Farooq";

/** The viewer as an employee record, where a screen needs their own facts. */
export function viewerEmployee(): Employee | undefined {
  return EMPLOYEES.find((employee) => employee.fullName === VIEWER_NAME);
}

/**
 * The people a given role's figures are computed from.
 *
 * FDN-38's rule, and the reason this is a function rather than a filter at each
 * callsite: **every aggregate is counted from the cohort, never filtered out of
 * a workspace-wide total after the fact.** A total summed over people the viewer
 * cannot see is wrong even when the rows beneath it are correct.
 *
 * A team member's cohort is themselves. That is the same rule at its smallest
 * rather than a special case, which is what lets every figure go through one
 * path regardless of who is looking.
 */
export function cohortFor(role: ViewerRole): Employee[] {
  if (role === "member") {
    const viewer = viewerEmployee();
    return viewer ? [viewer] : [];
  }

  const employees = EMPLOYEES.filter(
    (employee) => employee.employeeType === "Employee",
  );

  if (role === "manager") {
    return employees.filter(
      (employee) => profileFor(employee.employeeId)?.managerName === VIEWER_NAME,
    );
  }

  // Owner and HR Admin both see the whole workspace, per VPS-D004's matrix.
  return employees;
}

/** The cohort as employee ids, which is what `buildForecast` scopes by. */
export function cohortIdsFor(role: ViewerRole): Set<string> | undefined {
  // Undefined rather than every id: the forecast treats absence as
  // workspace-wide, and passing the full set would quietly drop Ghost
  // Resources, which are not in the employee cohort but do belong on the
  // Bench Forecast per VRS-F007.
  if (role === "owner" || role === "hr-admin") return undefined;
  return new Set(cohortFor(role).map((employee) => employee.employeeId));
}

/** Whether this role may read compensation. VRS-F002 and VRS-F005 both draw
 * the boundary here; a screen asks rather than restating the rule. */
export function canSeeCompensation(role: ViewerRole): boolean {
  return role === "owner" || role === "hr-admin";
}
