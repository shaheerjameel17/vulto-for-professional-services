import { z } from "zod";
import { SENIORITY_LEVELS } from "../employee";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

export const rateCardLineInputSchema = z
  .object({
    seniority_level: z.enum(SENIORITY_LEVELS),
    hourly_rate: z.number().nonnegative(),
  })
  .strict();

export const rateCardCreate = defineMutation({
  name: "rateCard.create",
  input: z
    .object({
      name: z.string().trim().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      lines: z.array(rateCardLineInputSchema),
    })
    .strict(),
  tier: 1,
  onlineOnly: true,
  stateTransition: false,
});

export const rateCardUpdate = defineMutation({
  name: "rateCard.update",
  input: z
    .object({
      rate_card_id: uuidV4Schema,
      expected_version: z.int().positive(),
      lines: z.array(rateCardLineInputSchema),
    })
    .strict(),
  tier: 1,
  onlineOnly: true,
  stateTransition: true,
});

export const RATE_CARD_MUTATIONS = {
  "rateCard.create": rateCardCreate,
  "rateCard.update": rateCardUpdate,
} as const;

export const rateCardListInputSchema = z
  .object({ workspace_id: uuidV4Schema })
  .strict();
export const rateCardPreviewInputSchema = z
  .object({
    rate_card_id: uuidV4Schema,
    seniority: z.enum(SENIORITY_LEVELS),
  })
  .strict();
export const rateCardUsageInputSchema = z
  .object({ rate_card_id: uuidV4Schema })
  .strict();
