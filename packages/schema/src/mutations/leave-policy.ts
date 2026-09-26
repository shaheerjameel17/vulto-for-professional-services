import { z } from "zod";
import { uuidV4Schema } from "../records";
import { leavePolicyConfigurationSchema } from "../leave-policy";
import { defineMutation } from "./define";

export const leavePolicyCreate = defineMutation({
  name: "leavePolicy.create",
  input: leavePolicyConfigurationSchema,
  tier: 0,
  onlineOnly: true,
  stateTransition: false,
});
export const leavePolicyUpdate = defineMutation({
  name: "leavePolicy.update",
  input: leavePolicyConfigurationSchema
    .pick({ leave_types: true })
    .extend({
      overtime_policy: leavePolicyConfigurationSchema.shape.overtime_policy
        .unwrap()
        .optional(),
      blackout_periods: leavePolicyConfigurationSchema.shape.blackout_periods
        .unwrap()
        .optional(),
      policy_id: uuidV4Schema,
      expected_version: z.int().positive(),
      effective_from: z.iso.date().optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: true,
  stateTransition: true,
});
export const LEAVE_POLICY_MUTATIONS = {
  "leavePolicy.create": leavePolicyCreate,
  "leavePolicy.update": leavePolicyUpdate,
} as const;
