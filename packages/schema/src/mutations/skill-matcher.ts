import { z } from "zod";
import { uuidV4Schema } from "../records";
import { proficiencyLevelSchema } from "../skill-matcher";
import { defineMutation } from "./define";

export const projectAttachSkillRequirement = defineMutation({
  name: "project.attachSkillRequirement",
  input: z
    .object({
      project_id: uuidV4Schema,
      skill_id: uuidV4Schema,
      proficiency_level_required: proficiencyLevelSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

/** Internal system-authored reaction, never a client mutation or router entry. */
export const skillGapEvaluateDefinition = defineMutation({
  name: "skillGap.evaluate",
  input: z.object({ project_id: uuidV4Schema, skill_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const SKILL_MATCHER_MUTATIONS = {
  "project.attachSkillRequirement": projectAttachSkillRequirement,
} as const;
