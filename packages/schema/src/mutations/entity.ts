import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "../records";
import { defineMutation } from "./define";

export const JURISDICTIONS = [
  "PK",
  "UK",
  "US",
  "AE",
  "SA",
  "IN",
  "SG",
  "Global",
] as const;

const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => Intl.supportedValuesOf("currency").includes(value),
    "Currency must be an ISO 4217 code",
  );

const fields = z
  .object({
    name: z.string().trim().min(1),
    legal_name: z.string().trim().min(1).nullable(),
    jurisdiction: z.enum(JURISDICTIONS),
    registered_address: z.string().trim().min(1).nullable(),
    registration_number: z.string().trim().min(1).nullable(),
    default_currency: currency,
  })
  .strict();

export const entityCreate = defineMutation({
  name: "entity.create",
  input: z
    .object({
      name: fields.shape.name,
      jurisdiction: fields.shape.jurisdiction,
      default_currency: currency,
      fields: fields
        .pick({ legal_name: true, registered_address: true, registration_number: true })
        .partial()
        .optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const entityUpdate = defineMutation({
  name: "entity.update",
  input: z
    .object({
      entity_id: uuidV4Schema,
      fields: fields.partial().refine((value) => Object.keys(value).length > 0),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const entityDeactivate = defineMutation({
  name: "entity.deactivate",
  input: z
    .object({ entity_id: uuidV4Schema, expected_version: z.int().positive() })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const employeeSetEntity = defineMutation({
  name: "employee.setEntity",
  input: z
    .object({
      employee_id: uuidV4Schema,
      entity_id: uuidV4Schema,
      effective_from: utcTimestampSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const ENTITY_MUTATIONS = {
  "entity.create": entityCreate,
  "entity.update": entityUpdate,
  "entity.deactivate": entityDeactivate,
  "employee.setEntity": employeeSetEntity,
} as const;
