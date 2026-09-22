import { z } from "zod";
import { jsonValueSchema, utcTimestampSchema, uuidV4Schema } from "../records";
import { defineMutation, type MutationDefinition } from "./define";
import { EMPLOYEE_MUTATIONS } from "./employee";
import { ENTITY_MUTATIONS } from "./entity";

const jsonObject = z.record(z.string(), jsonValueSchema);
const version = z.int().positive();

/**
 * The foundation mutations: the Tier 0 building blocks features will wrap. No
 * feature mutation is defined here. `graph.createNode` and
 * `graph.updateNodeFields` accept only node types whose every partition is
 * Tier 0; a split or protected type needs a named mutation from the feature
 * that owns it, which routes each field to its partition.
 */
export const graphCreateNode = defineMutation({
  name: "graph.createNode",
  input: z.object({ node: jsonObject }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const graphUpdateNodeFields = defineMutation({
  name: "graph.updateNodeFields",
  input: z
    .object({
      node_id: uuidV4Schema,
      expected_version: version.nullable(),
      patch: jsonObject,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const graphSoftDeleteNode = defineMutation({
  name: "graph.softDeleteNode",
  input: z.object({ node_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const graphCreateEdge = defineMutation({
  name: "graph.createEdge",
  input: z.object({ edge: jsonObject }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const graphCloseEdge = defineMutation({
  name: "graph.closeEdge",
  input: z.object({ edge_id: uuidV4Schema, effective_to: utcTimestampSchema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const graphTransitionLifecycle = defineMutation({
  name: "graph.transitionLifecycle",
  input: z
    .object({
      node_id: uuidV4Schema,
      to_status: z.string().min(1),
      expected_version: version,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const orgMoveEmployee = defineMutation({
  name: "org.moveEmployee",
  input: z
    .object({
      employee_id: uuidV4Schema,
      /** `null` ends the reporting line without starting another. */
      new_manager_id: uuidV4Schema.nullable(),
      /** Supplied by the caller and never defaulted to the clock (A003-T69). */
      effective_from: utcTimestampSchema,
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const MUTATIONS = {
  "graph.createNode": graphCreateNode,
  "graph.updateNodeFields": graphUpdateNodeFields,
  "graph.softDeleteNode": graphSoftDeleteNode,
  "graph.createEdge": graphCreateEdge,
  "graph.closeEdge": graphCloseEdge,
  "graph.transitionLifecycle": graphTransitionLifecycle,
  "org.moveEmployee": orgMoveEmployee,
  ...EMPLOYEE_MUTATIONS,
  ...ENTITY_MUTATIONS,
} as const;

export type MutationName = keyof typeof MUTATIONS;

/** The validated input of a foundation mutation. */
export type MutationArgs<Name extends MutationName> = z.infer<
  (typeof MUTATIONS)[Name]["input"]
>;

export function getMutationDefinition(name: string): MutationDefinition | undefined {
  return Object.hasOwn(MUTATIONS, name) ? MUTATIONS[name as MutationName] : undefined;
}

/**
 * The edge a move opens, derived from the mutation's id so the optimistic
 * client and the server agree on it and replication finds nothing to change.
 * Portable: this package also runs in the browser.
 */
export function moveEmployeeEdgeId(mutationId: string): string {
  // Flip the first 32 bits. The version and variant nibbles are untouched, so
  // the result is still a UUID v4, and the map is one-to-one, so two mutations
  // can never derive the same edge.
  const head = (Number.parseInt(mutationId.slice(0, 8), 16) ^ 0xa5a5a5a5) >>> 0;
  return `${head.toString(16).padStart(8, "0")}${mutationId.slice(8)}`;
}

/**
 * Whether making `newManager` the manager of `employee` would close a loop.
 * `managerOf` answers who manages a given employee at the move's effective
 * date, or `null`. Shared so the client rejects the same moves the server does.
 */
export async function wouldCreateCycle(
  managerOf: (employeeId: string) => Promise<string | null> | string | null,
  employee: string,
  newManager: string,
): Promise<boolean> {
  const seen = new Set<string>();
  let current: string | null = newManager;
  while (current !== null) {
    if (current === employee) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = await managerOf(current);
  }
  return false;
}
