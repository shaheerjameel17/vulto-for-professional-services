import { z } from "zod";
import { uuidV4Schema } from "./records";

export const NEAR_CAPACITY_WARNING_THRESHOLD_DEFAULT = 90;

/** Reads a workspace override, falling back to VRS-F008's default. */
export function readNearCapacityThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : NEAR_CAPACITY_WARNING_THRESHOLD_DEFAULT;
}

export const conflictResolutionSweepInputSchema = z
  .object({ workspace_id: uuidV4Schema })
  .strict();
