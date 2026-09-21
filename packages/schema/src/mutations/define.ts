import { z } from "zod";

/**
 * A named mutation, defined once (A003-T53). The same definition drives the
 * optimistic client version and the authoritative server version, so they
 * share one input schema.
 */
export interface MutationDefinition<
  Name extends string = string,
  Input extends z.ZodType = z.ZodType,
> {
  readonly name: Name;
  readonly input: Input;
  /** The highest data tier the mutation writes. */
  readonly tier: 0 | 1 | 2;
  /** Refused offline. Always true where `tier > 0` (A003-T63). */
  readonly onlineOnly: boolean;
  /** Carries the base `version` it was decided against (A003-T54). */
  readonly stateTransition: boolean;
}

export function defineMutation<
  const Name extends string,
  Input extends z.ZodType,
>(spec: {
  readonly name: Name;
  readonly input: Input;
  readonly tier: 0 | 1 | 2;
  readonly onlineOnly: boolean;
  readonly stateTransition: boolean;
}): MutationDefinition<Name, Input> {
  return {
    ...spec,
    // A protected write can never be queued offline, whatever was declared.
    onlineOnly: spec.tier > 0 ? true : spec.onlineOnly,
  };
}

/**
 * The lowest client schema version the server accepts uploads from (A003-T71).
 * Clients send their own in the `x-vulto-schema-version` header.
 */
export const MIN_CLIENT_SCHEMA_VERSION = 1;

export const SCHEMA_VERSION_HEADER = "x-vulto-schema-version";

/** The most mutations one `graph.applyMutations` call may carry. */
export const MAX_MUTATIONS_PER_CALL = 100;

/** The wire shape of one queued mutation. */
export const mutationEnvelopeSchema = z.object({
  mutation_id: z.uuidv4(),
  name: z.string().min(1),
  args: z.unknown(),
});

export const applyMutationsInputSchema = z.object({
  mutations: z.array(mutationEnvelopeSchema).max(MAX_MUTATIONS_PER_CALL),
});
