import { z } from "zod";
import { uuidV4Schema } from "../records";
import { revenueGapAlertDismissInputSchema } from "../revenue-gap-alert";
import { defineMutation } from "./define";

/** Internal reactive mutation, never accepted by graph.applyMutations. */
export const revenueGapAlertEvaluateDefinition = defineMutation({
  name: "revenueGapAlert.evaluate",
  input: z.object({ employee_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const revenueGapAlertDismiss = defineMutation({
  name: "revenueGapAlert.dismiss",
  input: revenueGapAlertDismissInputSchema,
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const REVENUE_GAP_ALERT_MUTATIONS = {
  "revenueGapAlert.dismiss": revenueGapAlertDismiss,
} as const;
