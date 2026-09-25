import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "./records";

/** VRS-F013 G02: the one proficiency order used by all skill consumers. */
export const PROFICIENCY_LEVELS = [
  "Beginner",
  "Intermediate",
  "Senior",
  "Expert",
] as const;
export const proficiencyLevelSchema = z.enum(PROFICIENCY_LEVELS);
export type ProficiencyLevel = z.infer<typeof proficiencyLevelSchema>;

export function proficiencyMeets(
  held: ProficiencyLevel,
  required: ProficiencyLevel,
): boolean {
  return PROFICIENCY_LEVELS.indexOf(held) >= PROFICIENCY_LEVELS.indexOf(required);
}

const universalFields = {
  node_id: uuidV4Schema,
  workspace_id: uuidV4Schema,
  schema_version: z.int().positive(),
  created_at: utcTimestampSchema,
  created_by: uuidV4Schema,
  updated_at: utcTimestampSchema,
  updated_by: uuidV4Schema,
  is_soft_deleted: z.boolean(),
  soft_deleted_at: utcTimestampSchema.nullable(),
  soft_deleted_by: uuidV4Schema.nullable(),
} as const;

export const skillFieldsSchema = z
  .object({
    ...universalFields,
    node_type: z.literal("Skill"),
    skill_id: uuidV4Schema,
    name: z.string().trim().min(1),
    category: z.string().trim().min(1).nullable(),
    lifecycle_status: z.enum(["Active", "Deprecated"]),
  })
  .strict();

export const projectStartDateSchema = z.iso.date().nullable();

export const skillGapFieldsSchema = z
  .object({
    ...universalFields,
    node_type: z.literal("SkillGap"),
    skill_gap_id: uuidV4Schema,
    project_id: uuidV4Schema,
    skill_id: uuidV4Schema,
    proficiency_level_required: proficiencyLevelSchema,
    identified_at: utcTimestampSchema,
    severity: z.enum(["Low", "Medium", "High", "Critical"]),
    lifecycle_status: z.enum(["Active", "Resolved"]),
    resolved_at: utcTimestampSchema.nullable(),
    resolved_by: z.union([uuidV4Schema, z.literal("system")]).nullable(),
  })
  .strict();

export type SkillGapSeverity = z.infer<typeof skillGapFieldsSchema>["severity"];

/** G07 counts working days externally; a missing start date is lenient Low. */
export function severityFor(workingDaysToStart: number | null): SkillGapSeverity {
  if (workingDaysToStart === null || workingDaysToStart > 60) return "Low";
  if (workingDaysToStart >= 30) return "Medium";
  if (workingDaysToStart >= 14) return "High";
  return "Critical";
}

export const projectMatchResultsInputSchema = z
  .object({
    project_id: uuidV4Schema,
    availability_window_days: z.int().nonnegative().default(30),
  })
  .strict();
export const skillMatcherAdHocInputSchema = z
  .object({
    query: z.string().trim().min(1),
    availability_window_days: z.int().nonnegative().default(30),
  })
  .strict();
export const skillGapListInputSchema = z
  .object({ workspace_id: uuidV4Schema })
  .strict();
