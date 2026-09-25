import { z } from "zod";
import {
  EMPLOYEE_STATUSES,
  employeeCompensationSchema,
  employeeCreateFieldsSchema,
  employeeUpdatePatchSchema,
} from "../employee";
import { utcTimestampSchema, uuidV4Schema } from "../records";
import { proficiencyLevelSchema } from "../skill-matcher";
import { defineMutation } from "./define";

/**
 * Employee's named mutations (`VRS-F002`, RST-33). Employee is a tier-split
 * node, so the generic node mutations refuse it (`requires-feature-mutation`):
 * these route each field to its own partition. Every one is server-validated
 * before it commits; the operational ones are also implemented optimistically
 * on the device (Tier 0), the compensation one is online-only (Tier 1).
 */

export const employeeCreate = defineMutation({
  name: "employee.create",
  input: z
    .object({
      employee_id: uuidV4Schema,
      /** The Entity the person is employed by: `scoped_to_entity`, set at creation (`VRS-F003`). */
      entity_id: uuidV4Schema,
      /** Supplied by the caller and never defaulted to the clock, like a reporting-line move. */
      effective_from: utcTimestampSchema,
      fields: employeeCreateFieldsSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const employeeUpdate = defineMutation({
  name: "employee.update",
  input: z
    .object({
      employee_id: uuidV4Schema,
      expected_version: z.int().positive(),
      patch: employeeUpdatePatchSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

/** Active → Inactive → Converted, `VRS-F002` G06. Carries the version it was decided against. */
export const employeeTransitionStatus = defineMutation({
  name: "employee.transitionStatus",
  input: z
    .object({
      employee_id: uuidV4Schema,
      to_status: z.enum(EMPLOYEE_STATUSES),
      expected_version: z.int().positive(),
      /** Required to go Inactive (offboarding records the end date); cleared on return to Active. */
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

/** Links an Employee to the person's login. Decides whose "own record" this is, so it is its own mutation. */
export const employeeLinkUser = defineMutation({
  name: "employee.linkUser",
  input: z
    .object({
      employee_id: uuidV4Schema,
      user_id: uuidV4Schema,
      expected_version: z.int().positive(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

/** The Tier 1 half. Never queued offline, never cached, written encrypted on the server. */
export const employeeSetCompensation = defineMutation({
  name: "employee.setCompensation",
  input: z
    .object({
      employee_id: uuidV4Schema,
      compensation: employeeCompensationSchema,
    })
    .strict(),
  tier: 1,
  onlineOnly: true,
  stateTransition: false,
});

export const employeeAttachSkill = defineMutation({
  name: "employee.attachSkill",
  input: z
    .object({
      employee_id: uuidV4Schema,
      skill_id: uuidV4Schema,
      proficiency_level: proficiencyLevelSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const EMPLOYEE_MUTATIONS = {
  "employee.create": employeeCreate,
  "employee.update": employeeUpdate,
  "employee.transitionStatus": employeeTransitionStatus,
  "employee.linkUser": employeeLinkUser,
  "employee.setCompensation": employeeSetCompensation,
} as const;

/**
 * Node types whose lifecycle a feature owns: the generic `graph.transitionLifecycle`
 * refuses them, because it would skip the feature's transition table.
 */
export const FEATURE_LIFECYCLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "Employee",
  "Entity",
  "RevenueGapAlert",
  "SkillGap",
]);
