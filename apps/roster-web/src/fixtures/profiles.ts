import { EMPLOYEES } from "./roster";

/*
 * Profile detail — VRS-F002's fields, for the fifteen real employees.
 * Ghosts aren't profiled here: a Ghost is a capacity placeholder per
 * VRS-F007, not an employment record, and this feature doesn't cover it.
 *
 * `compensation` is always present here as ground truth — the fixture
 * represents what actually exists in the graph. Whether a viewer is shown
 * it is decided once, in lib/profile.ts's buildProfile, never here and
 * never by the component that renders it.
 */

export type EmploymentType = "FullTime" | "PartTime" | "Contractor" | "Intern";
export type SeniorityLevel =
  | "Junior"
  | "Mid"
  | "Senior"
  | "Lead"
  | "Principal"
  | "Director";
export type ProficiencyLevel = "Beginner" | "Intermediate" | "Advanced" | "Expert";

export type ProfileSkill = {
  name: string;
  proficiency: ProficiencyLevel;
  verified: boolean;
};

export type ProfileCertification = {
  name: string;
  issuingBody: string;
  issueDate: string;
  expiryDate?: string;
};

export type ProfileDocument = {
  name: string;
  category: "Contract" | "ID" | "Certification" | "Policy Acknowledgement";
  uploadedAt: string;
};

export type ProfileActivityEntry = {
  date: string;
  description: string;
};

export type ProfileDetail = {
  employeeId: string;
  preferredName?: string;
  email: string;
  phone: string;
  department: string;
  employmentType: EmploymentType;
  seniorityLevel?: SeniorityLevel;
  startDate: string;
  probationEndDate?: string;
  probationStatus?: "Pending" | "Confirmed" | "Extended";
  contractEndDate?: string;
  /** Tier 0 — what the agency charges. Daily. Distinct from compensation. */
  billingRateDefault: number;
  contractedHours: number;
  billabilityTargetOverride?: number;
  /** Prose stand-in for VRS-F004's WorkingPattern — never computed here. */
  workingPatternNote: string;
  timezone: string;
  location: string;
  notes?: string;
  managerName?: string;
  skills: ProfileSkill[];
  certifications: ProfileCertification[];
  documents: ProfileDocument[];
  activity: ProfileActivityEntry[];
  /** Tier 1, end-to-end encrypted. Ground truth — access is decided in profile.ts. */
  compensation: {
    baseAmount: number;
    frequency: "Annual" | "Monthly";
    currency: string;
  };
};

const PROFILES: Record<string, ProfileDetail> = {
  "emp-01": {
    employeeId: "emp-01",
    email: "priya.sharma@northgate.studio",
    phone: "+44 7700 900123",
    department: "Design",
    employmentType: "FullTime",
    seniorityLevel: "Senior",
    startDate: "2022-03-14",
    billingRateDefault: 520,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "London, UK",
    notes: "Leads the Acme and Orchard design work. Prefers async review over standing meetings.",
    managerName: "Tom Beckett",
    skills: [
      { name: "Brand systems", proficiency: "Expert", verified: true },
      { name: "Figma", proficiency: "Expert", verified: true },
      { name: "Art direction", proficiency: "Advanced", verified: true },
      { name: "Motion design", proficiency: "Intermediate", verified: false },
    ],
    certifications: [
      { name: "Certified Scrum Product Owner", issuingBody: "Scrum Alliance", issueDate: "2023-06-01", expiryDate: "2026-06-01" },
    ],
    documents: [
      { name: "Employment Contract — Priya Sharma.pdf", category: "Contract", uploadedAt: "2022-03-10" },
      { name: "Right to Work — Passport.pdf", category: "ID", uploadedAt: "2022-03-10" },
      { name: "Handbook Acknowledgement 2026.pdf", category: "Policy Acknowledgement", uploadedAt: "2026-01-08" },
    ],
    activity: [
      { date: "2026-08-01", description: "Rolled off Acme Rebrand" },
      { date: "2026-06-12", description: "Promoted to Senior Designer" },
      { date: "2025-11-03", description: "Completed annual performance review" },
    ],
    compensation: { baseAmount: 68000, frequency: "Annual", currency: "GBP" },
  },
  "emp-02": {
    employeeId: "emp-02",
    preferredName: "Omar",
    email: "omar.farooq@northgate.studio",
    phone: "+92 300 1234567",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Lead",
    startDate: "2021-09-01",
    billingRateDefault: 460,
    contractedHours: 48,
    workingPatternNote: "Follows Northgate Karachi · PK calendar",
    timezone: "Asia/Karachi",
    location: "Karachi, PK",
    notes: "Team lead for the platform engineers. Runs the fortnightly architecture review.",
    managerName: "Tom Beckett",
    skills: [
      { name: "TypeScript", proficiency: "Expert", verified: true },
      { name: "Node", proficiency: "Expert", verified: true },
      { name: "Postgres", proficiency: "Advanced", verified: true },
      { name: "Team lead", proficiency: "Advanced", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Omar Farooq.pdf", category: "Contract", uploadedAt: "2021-08-28" },
      { name: "National ID.pdf", category: "ID", uploadedAt: "2021-08-28" },
    ],
    activity: [
      { date: "2026-07-14", description: "Committed above 100% capacity, override logged" },
      { date: "2024-02-19", description: "Promoted to Lead Engineer" },
    ],
    compensation: { baseAmount: 54000, frequency: "Annual", currency: "GBP" },
  },
  "emp-03": {
    employeeId: "emp-03",
    email: "hannah.weiss@northgate.studio",
    phone: "+44 7700 900456",
    department: "Product",
    employmentType: "FullTime",
    seniorityLevel: "Principal",
    startDate: "2020-01-20",
    billingRateDefault: 580,
    contractedHours: 40,
    billabilityTargetOverride: 60,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "Manchester, UK",
    notes: "Split across Acme (60%) and Meridian (40%). Reports directly to the founder.",
    managerName: "Nadia Rahman",
    skills: [
      { name: "Roadmapping", proficiency: "Expert", verified: true },
      { name: "Stakeholder management", proficiency: "Expert", verified: true },
      { name: "SQL", proficiency: "Intermediate", verified: false },
    ],
    certifications: [
      { name: "Pragmatic Institute Certified", issuingBody: "Pragmatic Institute", issueDate: "2021-04-15" },
    ],
    documents: [
      { name: "Employment Contract — Hannah Weiss.pdf", category: "Contract", uploadedAt: "2020-01-15" },
      { name: "Passport.pdf", category: "ID", uploadedAt: "2020-01-15" },
    ],
    activity: [
      { date: "2026-03-02", description: "Billability target overridden to 60%" },
      { date: "2023-08-11", description: "Promoted to Principal Product Manager" },
    ],
    compensation: { baseAmount: 72000, frequency: "Annual", currency: "GBP" },
  },
  "emp-04": {
    employeeId: "emp-04",
    email: "daniel.okonkwo@northgate.studio",
    phone: "+44 7700 900789",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Mid",
    startDate: "2023-05-08",
    probationEndDate: "2023-08-08",
    probationStatus: "Confirmed",
    billingRateDefault: 410,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "London, UK",
    managerName: "Omar Farooq",
    skills: [
      { name: "Go", proficiency: "Advanced", verified: true },
      { name: "Postgres", proficiency: "Intermediate", verified: true },
      { name: "Kubernetes", proficiency: "Intermediate", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Daniel Okonkwo.pdf", category: "Contract", uploadedAt: "2023-05-03" },
    ],
    activity: [
      { date: "2023-08-08", description: "Probation confirmed" },
      { date: "2023-05-08", description: "Joined as Backend Engineer" },
    ],
    compensation: { baseAmount: 61000, frequency: "Annual", currency: "GBP" },
  },
  "emp-05": {
    employeeId: "emp-05",
    preferredName: "Ash",
    email: "ayesha.malik@northgate.studio",
    phone: "+92 301 9876543",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Mid",
    startDate: "2022-11-01",
    billingRateDefault: 340,
    contractedHours: 44,
    workingPatternNote: "Follows Northgate Karachi · PK calendar",
    timezone: "Asia/Karachi",
    location: "Lahore, PK",
    notes: "Remote from Lahore; the Karachi office calendar applies to her contract, not Lahore's.",
    managerName: "Omar Farooq",
    skills: [
      { name: "React", proficiency: "Advanced", verified: true },
      { name: "TypeScript", proficiency: "Advanced", verified: true },
      { name: "Accessibility", proficiency: "Intermediate", verified: true },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Ayesha Malik.pdf", category: "Contract", uploadedAt: "2022-10-27" },
      { name: "CNIC.pdf", category: "ID", uploadedAt: "2022-10-27" },
    ],
    activity: [
      { date: "2025-01-10", description: "Completed WCAG 2.2 internal training" },
    ],
    compensation: { baseAmount: 44000, frequency: "Annual", currency: "GBP" },
  },
  "emp-06": {
    employeeId: "emp-06",
    email: "tom.beckett@northgate.studio",
    phone: "+44 7700 900321",
    department: "Leadership",
    employmentType: "FullTime",
    seniorityLevel: "Director",
    startDate: "2018-04-02",
    billingRateDefault: 720,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "London, UK",
    notes: "Founding creative lead. Splits time across every active pitch.",
    skills: [
      { name: "Creative direction", proficiency: "Expert", verified: true },
      { name: "New business", proficiency: "Advanced", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Tom Beckett.pdf", category: "Contract", uploadedAt: "2018-03-28" },
    ],
    activity: [
      { date: "2019-01-14", description: "Promoted to Creative Director" },
    ],
    compensation: { baseAmount: 88000, frequency: "Annual", currency: "GBP" },
  },
  "emp-07": {
    employeeId: "emp-07",
    email: "lena.petrova@northgate.studio",
    phone: "+44 7700 900654",
    department: "Product",
    employmentType: "Contractor",
    startDate: "2024-02-19",
    contractEndDate: "2026-11-30",
    billingRateDefault: 380,
    contractedHours: 30,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/Lisbon",
    location: "Lisbon, PT (remote)",
    notes: "Contract runs to end of November. Renewal conversation not yet started.",
    managerName: "Hannah Weiss",
    skills: [
      { name: "User research", proficiency: "Expert", verified: true },
      { name: "Interviewing", proficiency: "Advanced", verified: true },
      { name: "Synthesis", proficiency: "Advanced", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Contractor Agreement — Lena Petrova.pdf", category: "Contract", uploadedAt: "2024-02-14" },
    ],
    activity: [
      { date: "2024-02-19", description: "Engaged as UX Researcher, fixed term" },
    ],
    compensation: { baseAmount: 4200, frequency: "Monthly", currency: "GBP" },
  },
  "emp-08": {
    employeeId: "emp-08",
    email: "bilal.ahmed@northgate.studio",
    phone: "+92 302 5556677",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Senior",
    startDate: "2021-06-14",
    billingRateDefault: 420,
    contractedHours: 44,
    workingPatternNote: "Follows Northgate Karachi · PK calendar",
    timezone: "Asia/Karachi",
    location: "Karachi, PK",
    managerName: "Omar Farooq",
    skills: [
      { name: "Terraform", proficiency: "Advanced", verified: true },
      { name: "AWS", proficiency: "Advanced", verified: true },
      { name: "CI/CD", proficiency: "Expert", verified: false },
    ],
    certifications: [
      { name: "AWS Certified Solutions Architect", issuingBody: "AWS", issueDate: "2024-03-01", expiryDate: "2027-03-01" },
    ],
    documents: [
      { name: "Employment Contract — Bilal Ahmed.pdf", category: "Contract", uploadedAt: "2021-06-10" },
    ],
    activity: [
      { date: "2024-03-01", description: "AWS Solutions Architect certification renewed" },
    ],
    compensation: { baseAmount: 49000, frequency: "Annual", currency: "GBP" },
  },
  "emp-09": {
    employeeId: "emp-09",
    email: "grace.adeyemi@northgate.studio",
    phone: "+44 7700 900987",
    department: "Design",
    employmentType: "FullTime",
    seniorityLevel: "Senior",
    startDate: "2022-08-22",
    billingRateDefault: 500,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "Bristol, UK",
    managerName: "Tom Beckett",
    skills: [
      { name: "Design systems", proficiency: "Expert", verified: true },
      { name: "Figma", proficiency: "Advanced", verified: true },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Grace Adeyemi.pdf", category: "Contract", uploadedAt: "2022-08-17" },
    ],
    activity: [
      { date: "2025-09-30", description: "Completed annual performance review" },
    ],
    compensation: { baseAmount: 66000, frequency: "Annual", currency: "GBP" },
  },
  "emp-10": {
    employeeId: "emp-10",
    email: "marcus.hale@northgate.studio",
    phone: "+44 7700 900147",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Senior",
    startDate: "2021-02-01",
    billingRateDefault: 460,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "Leeds, UK",
    managerName: "Omar Farooq",
    skills: [
      { name: "dbt", proficiency: "Advanced", verified: true },
      { name: "BigQuery", proficiency: "Advanced", verified: true },
      { name: "Airflow", proficiency: "Intermediate", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Marcus Hale.pdf", category: "Contract", uploadedAt: "2021-01-27" },
    ],
    activity: [
      { date: "2026-08-05", description: "Logged pitch time against Halo Phase 2 opportunity" },
    ],
    compensation: { baseAmount: 70000, frequency: "Annual", currency: "GBP" },
  },
  "emp-11": {
    employeeId: "emp-11",
    email: "sana.iqbal@northgate.studio",
    phone: "+92 303 4443322",
    department: "Engineering",
    employmentType: "PartTime",
    seniorityLevel: "Mid",
    startDate: "2023-01-16",
    billingRateDefault: 260,
    contractedHours: 24,
    billabilityTargetOverride: 70,
    workingPatternNote: "Three-day week, effective 2023-01-16",
    timezone: "Asia/Karachi",
    location: "Karachi, PK",
    notes: "Part-time by arrangement since joining. Wednesdays and Fridays are not working days.",
    managerName: "Omar Farooq",
    skills: [
      { name: "Manual QA", proficiency: "Expert", verified: true },
      { name: "Playwright", proficiency: "Intermediate", verified: false },
    ],
    certifications: [
      { name: "ISTQB Foundation Level", issuingBody: "ISTQB", issueDate: "2022-05-01" },
    ],
    documents: [
      { name: "Employment Contract — Sana Iqbal.pdf", category: "Contract", uploadedAt: "2023-01-11" },
    ],
    activity: [
      { date: "2023-01-16", description: "Joined at three days a week" },
    ],
    compensation: { baseAmount: 38000, frequency: "Annual", currency: "GBP" },
  },
  "emp-12": {
    employeeId: "emp-12",
    email: "elliot.bruce@northgate.studio",
    phone: "+44 7700 900258",
    department: "Design",
    employmentType: "FullTime",
    seniorityLevel: "Mid",
    startDate: "2023-09-11",
    probationEndDate: "2023-12-11",
    probationStatus: "Confirmed",
    billingRateDefault: 360,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "London, UK",
    managerName: "Tom Beckett",
    skills: [
      { name: "After Effects", proficiency: "Advanced", verified: true },
      { name: "3D", proficiency: "Intermediate", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Elliot Bruce.pdf", category: "Contract", uploadedAt: "2023-09-06" },
    ],
    activity: [
      { date: "2023-12-11", description: "Probation confirmed" },
    ],
    compensation: { baseAmount: 52000, frequency: "Annual", currency: "GBP" },
  },
  "emp-13": {
    employeeId: "emp-13",
    email: "nadia.rahman@northgate.studio",
    phone: "+44 7700 900369",
    department: "Client Services",
    employmentType: "FullTime",
    seniorityLevel: "Director",
    startDate: "2019-06-03",
    billingRateDefault: 640,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "London, UK",
    notes: "Holds three concurrent accounts. First point of contact for Acme, Kestrel and Meridian.",
    skills: [
      { name: "Account management", proficiency: "Expert", verified: true },
      { name: "Contract negotiation", proficiency: "Advanced", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Nadia Rahman.pdf", category: "Contract", uploadedAt: "2019-05-29" },
    ],
    activity: [
      { date: "2022-04-01", description: "Promoted to Account Director" },
    ],
    compensation: { baseAmount: 79000, frequency: "Annual", currency: "GBP" },
  },
  "emp-14": {
    employeeId: "emp-14",
    email: "kwame.mensah@northgate.studio",
    phone: "+44 7700 900741",
    department: "Engineering",
    employmentType: "FullTime",
    seniorityLevel: "Senior",
    startDate: "2020-10-05",
    billingRateDefault: 440,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Ltd · UK calendar",
    timezone: "Europe/London",
    location: "Cardiff, UK",
    managerName: "Omar Farooq",
    skills: [
      { name: "Swift", proficiency: "Expert", verified: true },
      { name: "Kotlin", proficiency: "Advanced", verified: true },
    ],
    certifications: [],
    documents: [
      { name: "Employment Contract — Kwame Mensah.pdf", category: "Contract", uploadedAt: "2020-09-30" },
    ],
    activity: [
      { date: "2026-08-07", description: "Rolled off Halo Phase 2" },
    ],
    compensation: { baseAmount: 63000, frequency: "Annual", currency: "GBP" },
  },
  "emp-15": {
    employeeId: "emp-15",
    email: "zara.hussain@northgate.studio",
    phone: "+92 304 1112233",
    department: "Design",
    employmentType: "Intern",
    startDate: "2026-05-18",
    contractEndDate: "2026-11-18",
    billingRateDefault: 140,
    contractedHours: 40,
    workingPatternNote: "Follows Northgate Karachi · PK calendar",
    timezone: "Asia/Karachi",
    location: "Karachi, PK",
    notes: "Six-month placement, university-sponsored.",
    managerName: "Grace Adeyemi",
    skills: [
      { name: "Figma", proficiency: "Intermediate", verified: false },
      { name: "Illustration", proficiency: "Beginner", verified: false },
    ],
    certifications: [],
    documents: [
      { name: "Internship Agreement — Zara Hussain.pdf", category: "Contract", uploadedAt: "2026-05-13" },
    ],
    activity: [
      { date: "2026-05-18", description: "Started six-month internship" },
    ],
    compensation: { baseAmount: 22000, frequency: "Annual", currency: "GBP" },
  },
};

export function profileFor(employeeId: string): ProfileDetail | undefined {
  return PROFILES[employeeId];
}

/** Real employees only — Ghosts have no profile. Order matches the roster. */
export const PROFILED_EMPLOYEE_IDS = EMPLOYEES.filter(
  (e) => e.employeeType === "Employee",
).map((e) => e.employeeId);
