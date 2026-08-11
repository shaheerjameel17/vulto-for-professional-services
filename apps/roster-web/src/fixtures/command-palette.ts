import type { CommandPaletteResult } from "@vulto/ui";
import { PROFILED_EMPLOYEE_IDS, profileFor } from "./profiles";
import { EMPLOYEES, PROJECTS } from "./roster";

type IndexedResult = CommandPaletteResult & { keywords?: string };

const AVAILABILITY: Record<string, string> = {
  "emp-01": "Available Aug 19 · next rolloff Aug 18",
  "emp-02": "Available Aug 16 · next rolloff Aug 15",
  "emp-03": "Fully allocated · next rolloff Oct 6",
  "emp-04": "Available Aug 12 · next rolloff Aug 11",
  "emp-05": "Available Aug 21 · next rolloff Aug 20",
  "emp-06": "Fully allocated · next rolloff Sep 21",
  "emp-07": "Available Aug 28 · next rolloff Aug 27",
  "emp-08": "Fully allocated · next rolloff Nov 25",
  "emp-09": "Available Aug 10 · next rolloff Aug 9",
  "emp-10": "Available now · next rolloff not scheduled",
  "emp-11": "20% available · next rolloff Oct 31",
  "emp-12": "Available Sep 1 · next rolloff Aug 31",
  "emp-13": "Fully allocated · next rolloff Oct 11",
  "emp-14": "Available Aug 9 · next rolloff Aug 8",
  "emp-15": "Fully allocated · next rolloff Oct 24",
  "ghost-01": "Available from Sep 18 · no rolloff scheduled",
  "ghost-02": "Available from Sep 18 · no rolloff scheduled",
  "ghost-03": "Available from Oct 7 · no rolloff scheduled",
};

const COMMANDS: IndexedResult[] = [
  command("go-bench", "Go to Bench Forecast", "Open the 90-day capacity view", "/", "bench forecast capacity"),
  command("go-people", "Go to People", "Browse and filter the employee roster", "/people", "employees roster"),
  command("go-timesheets", "Go to Timesheets", "Open this week’s speed-run grid", "/timesheets", "time entries week"),
  command("go-home", "Go to Home", "Open your role-aware home and action queue", "/home", "manager dashboard queue approvals overview"),
  command("create-employee", "Create employee", "Start a new employee record", "/people", "add person"),
  command("add-assignment", "Add assignment", "Plan work from the Bench Forecast", "/", "create project allocation"),
  command("submit-timesheet", "Submit timesheet", "Review and submit the current week", "/timesheets", "send week"),
];

const PEOPLE: IndexedResult[] = EMPLOYEES.map((employee) => ({
  id: `person-${employee.employeeId}`,
  group: "People",
  name: employee.fullName,
  type: employee.employeeType === "Ghost" ? "Ghost" : "Person",
  context: AVAILABILITY[employee.employeeId] ?? "Availability not scheduled",
  dashed: employee.employeeType === "Ghost",
  href: employee.employeeType === "Employee" ? `/people/${employee.employeeId}` : undefined,
  keywords: `${employee.jobTitle} ${employee.entityId}`,
}));

const SKILL_MATCHES: IndexedResult[] = PROFILED_EMPLOYEE_IDS.flatMap((employeeId) => {
  const employee = EMPLOYEES.find((candidate) => candidate.employeeId === employeeId);
  const profile = profileFor(employeeId);
  if (!employee || !profile) return [];
  return profile.skills.map((skill) => ({
    id: `skill-${employeeId}-${slug(skill.name)}`,
    group: "Skill matches" as const,
    name: employee.fullName,
    type: "Skill match",
    context: `${skill.name} · ${skill.proficiency} · ${AVAILABILITY[employeeId]}`,
    href: `/people/${employeeId}`,
    keywords: `${skill.name} ${skill.proficiency}`,
  }));
});

const PROJECT_RESULTS: IndexedResult[] = PROJECTS.map((project) => ({
  id: `project-${project.projectId}`,
  group: "Projects",
  name: project.name,
  type: "Project",
  context: `${project.clientName} · active assignment planning`,
  href: "/",
}));

const CLIENT_RESULTS: IndexedResult[] = PROJECTS.map((project) => ({
  id: `client-${project.projectId}`,
  group: "Clients",
  name: project.clientName,
  type: "Client",
  context: `Active work · ${project.name}`,
  href: "/",
}));

const DOCUMENT_RESULTS: IndexedResult[] = PROFILED_EMPLOYEE_IDS.flatMap((employeeId) => {
  const employee = EMPLOYEES.find((candidate) => candidate.employeeId === employeeId);
  const profile = profileFor(employeeId);
  if (!employee || !profile) return [];
  return profile.documents.map((document, index) => ({
    id: `document-${employeeId}-${index}`,
    group: "Documents" as const,
    name: document.name,
    type: "Document",
    context: `${document.category} · ${employee.fullName}`,
    href: `/people/${employeeId}`,
  }));
});

const POLICY_RESULTS: IndexedResult[] = [
  {
    id: "policy-hybrid-working",
    group: "Policies",
    name: "Hybrid Working Policy",
    type: "Policy",
    context: "People operations · acknowledged Jan 2026",
  },
  {
    id: "policy-time-off",
    group: "Policies",
    name: "Time Off and Leave Policy",
    type: "Policy",
    context: "People operations · effective Apr 2026",
  },
  {
    id: "policy-timesheet",
    group: "Policies",
    name: "Timesheet Submission Policy",
    type: "Policy",
    context: "Operations · weekly submission standard",
  },
];

const INDEX: IndexedResult[] = [
  ...COMMANDS,
  ...PEOPLE,
  ...SKILL_MATCHES,
  ...PROJECT_RESULTS,
  ...CLIENT_RESULTS,
  ...DOCUMENT_RESULTS,
  ...POLICY_RESULTS,
];

export function searchCommandPalette(query: string): CommandPaletteResult[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  return INDEX.filter((result) => {
    // Skill matches are delegated only when the query is skill-shaped. A
    // person's name or job title must not fan out every skill they hold.
    const haystack = normalize(
      result.group === "Skill matches"
        ? result.keywords ?? ""
        : `${result.name} ${result.type} ${result.context} ${result.keywords ?? ""}`,
    );
    return terms.every((term) => haystack.includes(term));
  }).map(({ keywords: _keywords, ...result }) => result);
}

function command(
  id: string,
  name: string,
  context: string,
  href: string,
  keywords: string,
): IndexedResult {
  return { id, group: "Commands", name, type: "Command", context, href, keywords };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-");
}
