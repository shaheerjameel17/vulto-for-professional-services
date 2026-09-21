import { z } from "zod";

/** The most nodes one `protected.read` call may name. */
export const MAX_PROTECTED_READ_NODES = 500;

export const protectedReadInputSchema = z.object({
  node_ids: z.array(z.uuidv4()).max(MAX_PROTECTED_READ_NODES),
  partitions: z.array(z.string().min(1)).optional(),
});
