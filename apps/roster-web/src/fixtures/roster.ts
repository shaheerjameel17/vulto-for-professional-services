import { addDays, TODAY, type EntityId } from "./calendar";

/*
 * Mock data for the Bench Forecast, shaped like the graph rather than like the
 * screen: Employee nodes, Project nodes, and Assignment nodes carrying the
 * fields VRS-F005's schema defines. Bench time appears nowhere, because bench
 * time is never stored — it is derived at render from the absence of an
 * Assignment across the working-day index.
 *
 * Fifteen employees and three Ghost rows, per VPS-002's scope.
 *
 * Project UUIDs are real v4-shaped strings because VPS-D001 assigns the
 * categorical color by hashing them: a project is the same color on every
 * device without storing a color on the node.
 */

export type Project = {
  projectId: string;
  name: string;
  clientName: string;
};

export type Employee = {
  employeeId: string;
  /** Human-readable workspace code; the graph identifier remains the UUID. */
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  entityId: EntityId;
  /** VRS-F002: Employee or Ghost. Ghosts render identically. */
  employeeType: "Employee" | "Ghost";
  /** Tier 1, end-to-end encrypted. Annual, in GBP. */
  baseCompensationAmount: number;
};

export type Assignment = {
  assignmentId: string;
  employeeId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  billablePercentage: number;
  status: "Active" | "Completed" | "Canceled";
};

const d = (offset: number) => addDays(TODAY, offset);

export const PROJECTS: Project[] = [
  { projectId: "7c9e6b41-8a2d-4f13-9e77-2b5a1c0d8e94", name: "Acme Rebrand", clientName: "Acme Industrial" },
  { projectId: "3f1a8d25-6c74-4b90-a1e2-9d8c7b6a5f43", name: "Nomad", clientName: "Nomad Travel" },
  { projectId: "b8d47e02-1f63-4a58-8c91-7e2d5a3b9c06", name: "Halo Phase 2", clientName: "Halo Health" },
  { projectId: "e5a91c73-4d28-4e67-b3f0-1a8c6d9b2e57", name: "Meridian Portal", clientName: "Meridian Bank" },
  { projectId: "1d6f3b98-7e52-4c04-9a83-5b2e8d1c7f60", name: "Kestrel App", clientName: "Kestrel Logistics" },
  { projectId: "9a2c5e84-3b71-4d16-8f95-6c1a7e4b0d38", name: "Tandem Discovery", clientName: "Tandem Group" },
  { projectId: "4e8b1a67-9d35-4f82-a704-3c9e6b2d5a19", name: "Orchard CMS", clientName: "Orchard Retail" },
];

export const EMPLOYEES: Employee[] = [
  { employeeId: "emp-01", employeeCode: "EMP-001", fullName: "Priya Sharma", jobTitle: "Senior Designer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 68000 },
  { employeeId: "emp-02", employeeCode: "EMP-002", fullName: "Omar Farooq", jobTitle: "Lead Engineer", entityId: "pk", employeeType: "Employee", baseCompensationAmount: 54000 },
  { employeeId: "emp-03", employeeCode: "EMP-003", fullName: "Hannah Weiss", jobTitle: "Product Manager", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 72000 },
  { employeeId: "emp-04", employeeCode: "EMP-004", fullName: "Daniel Okonkwo", jobTitle: "Backend Engineer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 61000 },
  { employeeId: "emp-05", employeeCode: "EMP-005", fullName: "Ayesha Malik", jobTitle: "Frontend Engineer", entityId: "pk", employeeType: "Employee", baseCompensationAmount: 44000 },
  { employeeId: "emp-06", employeeCode: "EMP-006", fullName: "Tom Beckett", jobTitle: "Creative Director", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 88000 },
  { employeeId: "emp-07", employeeCode: "EMP-007", fullName: "Lena Petrova", jobTitle: "UX Researcher", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 56000 },
  { employeeId: "emp-08", employeeCode: "EMP-008", fullName: "Bilal Ahmed", jobTitle: "DevOps Engineer", entityId: "pk", employeeType: "Employee", baseCompensationAmount: 49000 },
  { employeeId: "emp-09", employeeCode: "EMP-009", fullName: "Grace Adeyemi", jobTitle: "Senior Designer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 66000 },
  { employeeId: "emp-10", employeeCode: "EMP-010", fullName: "Marcus Hale", jobTitle: "Data Engineer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 70000 },
  { employeeId: "emp-11", employeeCode: "EMP-011", fullName: "Sana Iqbal", jobTitle: "QA Engineer", entityId: "pk", employeeType: "Employee", baseCompensationAmount: 38000 },
  { employeeId: "emp-12", employeeCode: "EMP-012", fullName: "Elliot Bruce", jobTitle: "Motion Designer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 52000 },
  { employeeId: "emp-13", employeeCode: "EMP-013", fullName: "Nadia Rahman", jobTitle: "Account Director", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 79000 },
  { employeeId: "emp-14", employeeCode: "EMP-014", fullName: "Kwame Mensah", jobTitle: "Mobile Engineer", entityId: "uk", employeeType: "Employee", baseCompensationAmount: 63000 },
  { employeeId: "emp-15", employeeCode: "EMP-015", fullName: "Zara Hussain", jobTitle: "Junior Designer", entityId: "pk", employeeType: "Employee", baseCompensationAmount: 29000 },

  // Ghost rows. VRS-F007: the role title stands where a name would be, and the
  // Employee node carries `job_title` and `start_date` like any other.
  { employeeId: "ghost-01", employeeCode: "GHOST-001", fullName: "Senior Backend Engineer", jobTitle: "Senior", entityId: "uk", employeeType: "Ghost", baseCompensationAmount: 65000 },
  { employeeId: "ghost-02", employeeCode: "GHOST-002", fullName: "Senior Backend Engineer", jobTitle: "Senior", entityId: "uk", employeeType: "Ghost", baseCompensationAmount: 65000 },
  { employeeId: "ghost-03", employeeCode: "GHOST-003", fullName: "Design Lead", jobTitle: "Lead", entityId: "pk", employeeType: "Ghost", baseCompensationAmount: 58000 },
];

export const ASSIGNMENTS: Assignment[] = [
  // Priya — rolls off Acme, three-week gap, then Orchard. The canonical case.
  a("as-01", "emp-01", 0, d(-30), d(11), 100),
  a("as-02", "emp-01", 6, d(34), d(88), 100),

  // Omar — short gap between Nomad and Halo.
  a("as-03", "emp-02", 1, d(-20), d(8), 100),
  a("as-04", "emp-02", 2, d(17), d(75), 100),

  // Hannah — continuous. Nothing to see, which is the point of contrast.
  a("as-05", "emp-03", 3, d(-40), d(120), 60),
  a("as-06", "emp-03", 0, d(-40), d(60), 40),

  // Daniel — long gap starting soon. The expensive one.
  a("as-07", "emp-04", 2, d(-15), d(4), 100),
  a("as-08", "emp-04", 4, d(52), d(140), 100),

  // Ayesha — Karachi. Gap crosses two Saturdays, which are working half-days.
  a("as-09", "emp-05", 4, d(-25), d(13), 100),
  a("as-10", "emp-05", 6, d(30), d(95), 100),

  // Tom — partial allocation across two projects, no gap.
  a("as-11", "emp-06", 0, d(-60), d(45), 50),
  a("as-12", "emp-06", 5, d(-10), d(70), 50),

  // Lena — ends and does not come back inside the window.
  a("as-13", "emp-07", 5, d(-18), d(20), 100),

  // Bilal — continuous.
  a("as-14", "emp-08", 3, d(-30), d(110), 100),

  // Grace — two short gaps.
  a("as-15", "emp-09", 0, d(-22), d(2), 100),
  a("as-16", "emp-09", 6, d(16), d(38), 100),
  a("as-17", "emp-09", 3, d(55), d(100), 100),

  // Marcus — starts late, currently on the bench.
  a("as-18", "emp-10", 3, d(26), d(120), 100),

  // Sana — continuous at 80%.
  a("as-19", "emp-11", 2, d(-14), d(85), 80),

  // Elliot — one gap in the middle.
  a("as-20", "emp-12", 5, d(-8), d(24), 100),
  a("as-21", "emp-12", 1, d(48), d(92), 100),

  // Nadia — spread thin across three.
  a("as-22", "emp-13", 0, d(-35), d(65), 34),
  a("as-23", "emp-13", 2, d(-35), d(65), 33),
  a("as-24", "emp-13", 4, d(-35), d(65), 33),

  // Kwame — rolls off tomorrow, back in five weeks.
  a("as-25", "emp-14", 4, d(-45), d(1), 100),
  a("as-26", "emp-14", 1, d(36), d(105), 100),

  // Zara — continuous.
  a("as-27", "emp-15", 6, d(-12), d(78), 100),

  // Ghosts, assigned before anyone is hired. VRS-F007: a Ghost is assignable
  // identically to a real employee, including the 100% capacity constraint.
  a("as-28", "ghost-01", 2, d(42), d(130), 100),
  a("as-29", "ghost-02", 2, d(42), d(130), 100),
  a("as-30", "ghost-03", 3, d(60), d(150), 100),
];

function a(
  assignmentId: string,
  employeeId: string,
  projectIndex: number,
  startDate: string,
  endDate: string,
  billablePercentage: number,
): Assignment {
  return {
    assignmentId,
    employeeId,
    // Non-null: every index above is within PROJECTS.
    projectId: PROJECTS[projectIndex]!.projectId,
    startDate,
    endDate,
    billablePercentage,
    status: "Active",
  };
}

/*
 * Days carrying Pitch-categorized time, per VRS-F009.
 *
 * VRS-F005's bench computation subtracts these: a person pursuing new business
 * is not idle, and a forecast that painted them amber would train users to
 * ignore the color that matters most.
 */
export const PITCH_DAYS: Record<string, string[]> = {
  "emp-04": [d(8), d(9), d(10), d(11), d(12), d(15)],
  "emp-07": [d(24), d(25), d(26)],
  "emp-10": [d(-1), d(0), d(1), d(2)],
};

export const PROJECT_BY_ID = new Map(
  PROJECTS.map((project) => [project.projectId, project]),
);
