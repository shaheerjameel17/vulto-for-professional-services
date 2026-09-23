import { z } from "zod";
import {
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
  ghostEmployeeCreateFieldsSchema,
} from "../employee";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

const version = z.int().positive();

export const ghostResourceCreate = defineMutation({
  name: "ghostResource.create",
  input: z
    .object({
      role_title: ghostEmployeeCreateFieldsSchema.shape.job_title,
      projected_start_date: ghostEmployeeCreateFieldsSchema.shape.start_date,
      seniority_level: z.enum(SENIORITY_LEVELS).nullable().optional(),
      target_skill_ids: z.array(uuidV4Schema).optional(),
      expected_rate: z.number().nonnegative().nullable().optional(),
      open_role_id: uuidV4Schema.optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const ghostResourceCancel = defineMutation({
  name: "ghostResource.cancel",
  input: z.object({ ghost_id: uuidV4Schema, expected_version: version }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const ghostResourceLinkOpenRole = defineMutation({
  name: "ghostResource.linkOpenRole",
  input: z.object({ ghost_id: uuidV4Schema, open_role_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

const promotionDetails = z
  .object({
    employee_code: z.string().min(1).max(40),
    full_name: z.string().min(1).max(200),
    email: z.email(),
    employment_type: z.enum(EMPLOYMENT_TYPES),
    start_date: z.iso.date(),
    contracted_hours: z.number().nonnegative().max(168).optional(),
  })
  .strict();
const unsupportedExistingEmployee = z
  .object({ existing_employee_id: uuidV4Schema })
  .strict();

export const ghostResourcePromote = defineMutation({
  name: "ghostResource.promote",
  input: z
    .object({
      ghost_id: uuidV4Schema,
      expected_version: version,
      details: z.union([promotionDetails, unsupportedExistingEmployee]),
    })
    .strict(),
  tier: 0,
  onlineOnly: true,
  stateTransition: true,
});

export const GHOST_RESOURCE_MUTATIONS = {
  "ghostResource.create": ghostResourceCreate,
  "ghostResource.cancel": ghostResourceCancel,
  "ghostResource.linkOpenRole": ghostResourceLinkOpenRole,
  "ghostResource.promote": ghostResourcePromote,
} as const;
