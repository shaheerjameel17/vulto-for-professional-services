import { z } from "zod";
import { pitchIdentifyingFieldsSchema } from "../pitch";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

export const pitchCreate = defineMutation({
  name: "pitch.create",
  input: z
    .object({
      name: pitchIdentifyingFieldsSchema.shape.name,
      client_id: pitchIdentifyingFieldsSchema.shape.client_id.optional(),
      projected_start_date:
        pitchIdentifyingFieldsSchema.shape.projected_start_date.optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

const staffingInput = z
  .object({ pitch_id: uuidV4Schema, employee_id: uuidV4Schema })
  .strict();

export const pitchStaffEmployee = defineMutation({
  name: "pitch.staffEmployee",
  input: staffingInput,
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const pitchUnstaffEmployee = defineMutation({
  name: "pitch.unstaffEmployee",
  input: staffingInput,
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const PITCH_MUTATIONS = {
  "pitch.create": pitchCreate,
  "pitch.staffEmployee": pitchStaffEmployee,
  "pitch.unstaffEmployee": pitchUnstaffEmployee,
} as const;
