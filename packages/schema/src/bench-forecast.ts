import { z } from "zod";
import { SENIORITY_LEVELS } from "./employee";
import { uuidV4Schema } from "./records";

export const benchForecastWindowSchema = z
  .object({ from_date: z.iso.date(), to_date: z.iso.date() })
  .strict()
  .refine((window) => window.to_date >= window.from_date, {
    message: "to_date must be on or after from_date",
  });

export const benchForecastFiltersSchema = z
  .object({
    skillIds: z.array(uuidV4Schema).optional(),
    seniorityLevels: z.array(z.enum(SENIORITY_LEVELS)).optional(),
    departments: z.array(z.string()).optional(),
    entityIds: z.array(uuidV4Schema).optional(),
    availability: z
      .object({ fromDate: z.iso.date(), toDate: z.iso.date() })
      .strict()
      .refine((range) => range.toDate >= range.fromDate, {
        message: "toDate must be on or after fromDate",
      })
      .optional(),
  })
  .strict();

export type BenchForecastWindow = z.infer<typeof benchForecastWindowSchema>;
export type BenchForecastFilters = z.infer<typeof benchForecastFiltersSchema>;

export interface BenchForecastFilterCandidate {
  readonly skillIds: readonly string[];
  readonly seniorityLevel: string | null;
  readonly department: string | null;
  readonly entityId: string | null;
  /** G02 bench days already derived by the caller through resolveWorkingDay. */
  readonly benchDays: readonly string[];
}

const includesOne = (selected: readonly string[] | undefined, actual: string | null) =>
  selected === undefined ||
  selected.length === 0 ||
  (actual !== null && selected.includes(actual));

/** F242: one matcher used unchanged by the device query and server aggregate. */
export function matchesBenchForecastFilters(
  candidate: BenchForecastFilterCandidate,
  filters?: BenchForecastFilters,
): boolean {
  if (!filters) return true;
  if (
    filters.skillIds !== undefined &&
    filters.skillIds.length > 0 &&
    !filters.skillIds.some((id) => candidate.skillIds.includes(id))
  ) {
    return false;
  }
  if (!includesOne(filters.seniorityLevels, candidate.seniorityLevel)) return false;
  if (!includesOne(filters.departments, candidate.department)) return false;
  if (!includesOne(filters.entityIds, candidate.entityId)) return false;
  if (
    filters.availability !== undefined &&
    !candidate.benchDays.some(
      (date) =>
        filters.availability!.fromDate <= date && date <= filters.availability!.toDate,
    )
  ) {
    return false;
  }
  return true;
}

export const benchForecastGetInputSchema = z
  .object({
    workspace_id: uuidV4Schema,
    window: benchForecastWindowSchema,
    filters: benchForecastFiltersSchema.optional(),
  })
  .strict();

export const benchForecastCostInputSchema = z
  .object({
    employee_ids: z.array(uuidV4Schema).max(500),
    window: benchForecastWindowSchema,
  })
  .strict();

export const contextualIntelligenceInputSchema = z
  .object({ employee_id: uuidV4Schema })
  .strict();
