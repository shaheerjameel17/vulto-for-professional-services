import { z } from "zod";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

/** Internal reactive mutation; deliberately absent from client-upload MUTATIONS. */
export const utilizationSnapshotComputeDefinition = defineMutation({
  name: "utilizationSnapshot.compute",
  input: z
    .object({ employee_id: uuidV4Schema, week_start_date: z.iso.date() })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});
