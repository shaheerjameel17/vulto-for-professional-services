import { z } from "zod";

/**
 * The Employee node's fields, as `VRS-F002` specifies them and `VPS-A002`
 * splits them: an operational (Tier 0) half that lives in `graph_nodes.record`
 * and reaches devices, and a compensation (Tier 1) half that is field-encrypted
 * on the server and never reaches one.
 *
 * Deliberately not fields here, because storing them would duplicate or invent
 * a second answer:
 *  - `employment_status` is the node's `lifecycle_status` (Active, Inactive,
 *    Converted), one fact in one place.
 *  - `workspace_id` and provenance come from the universal node conventions.
 *  - `user_id` is the link to the person's login; it is set only by
 *    `employee.linkUser`, never by create or update, because it decides whose
 *    "own record" this is.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");
const nullableText = z.string().min(1).nullable();

export const EMPLOYMENT_TYPES = [
  "FullTime",
  "PartTime",
  "Contractor",
  "Intern",
] as const;
export const SENIORITY_LEVELS = [
  "Junior",
  "Mid",
  "Senior",
  "Lead",
  "Principal",
  "Director",
  "CLevel",
] as const;
export const PROBATION_STATUSES = [
  "Pending",
  "Confirmed",
  "Extended",
  "Terminated",
] as const;
export const CONTRACT_RENEWAL_STATUSES = [
  "Pending",
  "Renewed",
  "Converted",
  "Ended",
] as const;
export const COMPENSATION_FREQUENCIES = ["Annual", "Monthly", "Hourly"] as const;

/** The operational half, every field optional; create and update narrow it. */
const operationalShape = {
  employee_type: z.enum(["Employee", "Ghost"]),
  full_name: z.string().min(1).max(200),
  preferred_name: nullableText,
  email: z.email(),
  phone: nullableText,
  avatar_url: nullableText,
  job_title: z.string().min(1).max(200),
  department: nullableText,
  employment_type: z.enum(EMPLOYMENT_TYPES),
  seniority_level: z.enum(SENIORITY_LEVELS).nullable(),
  start_date: isoDate,
  end_date: isoDate.nullable(),
  probation_end_date: isoDate.nullable(),
  probation_status: z.enum(PROBATION_STATUSES).nullable(),
  probation_extension_reason: nullableText,
  contract_end_date: isoDate.nullable(),
  contract_renewal_status: z.enum(CONTRACT_RENEWAL_STATUSES).nullable(),
  /** DAILY: what the agency charges for this person's time. Not compensation. */
  billing_rate_default: z.number().nonnegative().nullable(),
  /** Weekly. Zero is valid and deliberate. */
  contracted_hours: z.number().nonnegative().max(168),
  billability_target_override: z.number().min(0).max(1).nullable(),
  working_pattern_id: z.uuidv4().nullable(),
  timezone: nullableText,
  location: nullableText,
  notes: nullableText,
} as const;

/** What create accepts: the required fields, and any optional field. `contracted_hours` defaults on the server. */
export const employeeCreateFieldsSchema = z
  .object({
    employee_code: z.string().min(1).max(40),
    full_name: operationalShape.full_name,
    email: operationalShape.email,
    job_title: operationalShape.job_title,
    employment_type: operationalShape.employment_type,
    start_date: operationalShape.start_date,
    employee_type: operationalShape.employee_type.optional(),
    preferred_name: operationalShape.preferred_name.optional(),
    phone: operationalShape.phone.optional(),
    avatar_url: operationalShape.avatar_url.optional(),
    department: operationalShape.department.optional(),
    seniority_level: operationalShape.seniority_level.optional(),
    probation_end_date: operationalShape.probation_end_date.optional(),
    probation_status: operationalShape.probation_status.optional(),
    probation_extension_reason: operationalShape.probation_extension_reason.optional(),
    contract_end_date: operationalShape.contract_end_date.optional(),
    contract_renewal_status: operationalShape.contract_renewal_status.optional(),
    billing_rate_default: operationalShape.billing_rate_default.optional(),
    contracted_hours: operationalShape.contracted_hours.optional(),
    billability_target_override:
      operationalShape.billability_target_override.optional(),
    working_pattern_id: operationalShape.working_pattern_id.optional(),
    timezone: operationalShape.timezone.optional(),
    location: operationalShape.location.optional(),
    notes: operationalShape.notes.optional(),
  })
  .strict();

export type EmployeeCreateFields = z.infer<typeof employeeCreateFieldsSchema>;

/**
 * What update accepts: any operational field except the ones with their own
 * mutation. `employee_code` is fixed at creation, `end_date` belongs to the
 * status transition, and no compensation field is accepted here at all
 * (`.strict()` refuses it), because a tier-split node's protected half has its
 * own mutation.
 */
export const employeeUpdatePatchSchema = z
  .object({
    employee_type: operationalShape.employee_type,
    full_name: operationalShape.full_name,
    preferred_name: operationalShape.preferred_name,
    email: operationalShape.email,
    phone: operationalShape.phone,
    avatar_url: operationalShape.avatar_url,
    job_title: operationalShape.job_title,
    department: operationalShape.department,
    employment_type: operationalShape.employment_type,
    seniority_level: operationalShape.seniority_level,
    start_date: operationalShape.start_date,
    probation_end_date: operationalShape.probation_end_date,
    probation_status: operationalShape.probation_status,
    probation_extension_reason: operationalShape.probation_extension_reason,
    contract_end_date: operationalShape.contract_end_date,
    contract_renewal_status: operationalShape.contract_renewal_status,
    billing_rate_default: operationalShape.billing_rate_default,
    contracted_hours: operationalShape.contracted_hours,
    billability_target_override: operationalShape.billability_target_override,
    working_pattern_id: operationalShape.working_pattern_id,
    timezone: operationalShape.timezone,
    location: operationalShape.location,
    notes: operationalShape.notes,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "A patch must change something");

export type EmployeeUpdatePatch = z.infer<typeof employeeUpdatePatchSchema>;

/** The Tier 1 half: field-encrypted on the server, in the `compensation` partition, never on a device. */
export const employeeCompensationSchema = z
  .object({
    base_compensation_amount: z.number().nonnegative().nullable(),
    compensation_frequency: z.enum(COMPENSATION_FREQUENCIES).nullable(),
    /** ISO 4217. Defaults to the scoped Entity's currency where the caller leaves it out. */
    compensation_currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  })
  .strict();

export type EmployeeCompensation = z.infer<typeof employeeCompensationSchema>;

/** The partition key of the Tier 1 half, as `VPS-A002` registers it. */
export const EMPLOYEE_COMPENSATION_PARTITION = "compensation";

export const EMPLOYEE_STATUSES = ["Active", "Inactive", "Converted"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** `VRS-F002` G06: the only valid transitions. Anything else is refused before it commits. */
export const EMPLOYEE_STATUS_TRANSITIONS: Readonly<
  Record<EmployeeStatus, readonly EmployeeStatus[]>
> = {
  Active: ["Inactive", "Converted"],
  Inactive: ["Active"],
  Converted: [],
};

export function isValidEmployeeTransition(from: string, to: string): boolean {
  const allowed = EMPLOYEE_STATUS_TRANSITIONS[from as EmployeeStatus];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

/**
 * The Tier 0 record a create produces, with the defaults `VRS-F002` states
 * filled in. Shared so the optimistic client and the server build the same
 * record and replication finds nothing to change. Manual creation and import
 * both go through it (RST-33: they produce equivalent canonical records).
 */
export function employeeOperationalRecord(
  fields: EmployeeCreateFields,
): Record<string, unknown> {
  return {
    employee_code: fields.employee_code,
    user_id: null,
    employee_type: fields.employee_type ?? "Employee",
    full_name: fields.full_name,
    preferred_name: fields.preferred_name ?? null,
    email: fields.email.toLowerCase(),
    phone: fields.phone ?? null,
    avatar_url: fields.avatar_url ?? null,
    job_title: fields.job_title,
    department: fields.department ?? null,
    employment_type: fields.employment_type,
    seniority_level: fields.seniority_level ?? null,
    start_date: fields.start_date,
    end_date: null,
    probation_end_date: fields.probation_end_date ?? null,
    probation_status: fields.probation_status ?? null,
    probation_extension_reason: fields.probation_extension_reason ?? null,
    contract_end_date: fields.contract_end_date ?? null,
    contract_renewal_status: fields.contract_renewal_status ?? null,
    billing_rate_default: fields.billing_rate_default ?? null,
    // `VRS-F002` G07: 40 for FullTime; other employment types are prompted, so
    // a caller who leaves it out gets the same 40 rather than a guess.
    contracted_hours: fields.contracted_hours ?? 40,
    billability_target_override: fields.billability_target_override ?? null,
    working_pattern_id: fields.working_pattern_id ?? null,
    timezone: fields.timezone ?? null,
    location: fields.location ?? null,
    notes: fields.notes ?? null,
  };
}

/** Email is compared case-insensitively and stored lower-cased. */
export const normalizeEmployeeEmail = (email: string): string => email.toLowerCase();

export type EmployeeTransitionOutcome =
  | { readonly ok: true; readonly endDate: string | null }
  | { readonly ok: false; readonly reason: "invalid-transition" | "end-date-required" };

/**
 * Whether a status change is allowed and what `end_date` it leaves. Going
 * Inactive records the end date (offboarding is one deliberate action); coming
 * back to Active clears it; Converted leaves it as it was.
 */
export function employeeTransitionOutcome(
  from: string,
  to: string,
  endDate: string | null | undefined,
  currentEndDate: string | null,
): EmployeeTransitionOutcome {
  if (!isValidEmployeeTransition(from, to))
    return { ok: false, reason: "invalid-transition" };
  if (to === "Inactive") {
    if (endDate === undefined || endDate === null) {
      return { ok: false, reason: "end-date-required" };
    }
    return { ok: true, endDate };
  }
  if (to === "Active") return { ok: true, endDate: null };
  return { ok: true, endDate: currentEndDate };
}

export const employeeListInputSchema = z
  .object({ lifecycle_status: z.enum(EMPLOYEE_STATUSES).optional() })
  .strict();

export const employeeGetInputSchema = z.object({ employee_id: z.uuidv4() }).strict();
