import type { AppRouter } from "@vulto/api";
import type { getEmployeeForProfile } from "@vulto/graph";
import { apiOrigin } from "./auth-client";

type Caller = ReturnType<AppRouter["createCaller"]>;
export type EmployeeAnswer = Awaited<ReturnType<Caller["employee"]["get"]>>;
export type LocalEmployeeProfile = NonNullable<
  Awaited<ReturnType<typeof getEmployeeForProfile>>
>;

/** Protected answer lives only in React memory; this is not a graph cache query. */
export async function fetchEmployee(
  employeeId: string,
  signal: AbortSignal,
): Promise<EmployeeAnswer> {
  const response = await fetch(
    `${apiOrigin}/trpc/employee.get?input=${encodeURIComponent(JSON.stringify({ employee_id: employeeId }))}`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok)
    throw Object.assign(new Error("Employee requires a connection"), {
      status: response.status,
    });
  const body = (await response.json()) as { result: { data: EmployeeAnswer } };
  return body.result.data;
}

export type EmployeeProfile = ReturnType<typeof profileFromLocal>;
export function profileFromLocal(row: LocalEmployeeProfile) {
  const r = row.operational;
  const text = (key: string) => (typeof r[key] === "string" ? (r[key] as string) : "");
  const number = (key: string) =>
    typeof r[key] === "number" ? (r[key] as number) : null;
  return {
    ...row,
    fullName: text("full_name"),
    preferredName: text("preferred_name") || null,
    jobTitle: text("job_title"),
    department: text("department"),
    email: text("email"),
    phone: text("phone"),
    employmentType: text("employment_type"),
    seniorityLevel: text("seniority_level"),
    startDate: text("start_date"),
    timezone: text("timezone"),
    location: text("location"),
    notes: text("notes"),
    probationStatus: text("probation_status"),
    probationEndDate: text("probation_end_date"),
    contractEndDate: text("contract_end_date"),
    contractedHours: number("contracted_hours"),
    billingRateDefault: number("billing_rate_default"),
    billabilityTargetOverride: number("billability_target_override"),
    workingPatternNote: "Resolved through the working calendar.",
    certifications: [] as {
      name: string;
      issuingBody: string;
      issueDate: string;
      expiryDate?: string;
    }[],
    documents: [] as { name: string; uploadedAt: string; category: string }[],
    activity: [] as { date: string; description: string }[],
  };
}
