import {
  assertRegisteredRelationship,
  edgeTypeSchema,
  nodeTypeSchema,
  utcTimestampSchema,
  uuidV4Schema,
} from "@vulto/schema";
import { z } from "zod";

const pageLimitSchema = z.number().int().min(1).max(200).default(50);
const queryBase = {
  includeSoftDeleted: z.boolean().default(false),
} as const;

const exactRelationshipShape = {
  edgeType: edgeTypeSchema,
  fromNodeType: nodeTypeSchema,
  toNodeType: nodeTypeSchema,
} as const;

const nodeGetQuerySchema = z
  .object({
    kind: z.literal("node-get"),
    nodeId: uuidV4Schema,
    nodeType: nodeTypeSchema,
    ...queryBase,
  })
  .strict();

const nodeListQuerySchema = z
  .object({
    kind: z.literal("node-list"),
    nodeType: nodeTypeSchema,
    lifecycleStatus: z.string().min(1).optional(),
    afterNodeId: uuidV4Schema.optional(),
    limit: pageLimitSchema,
    ...queryBase,
  })
  .strict();

const edgeNeighborsQuerySchema = z
  .object({
    kind: z.literal("edge-neighbors"),
    startNodeId: uuidV4Schema,
    direction: z.enum(["outgoing", "incoming"]),
    asOf: utcTimestampSchema,
    afterEdgeId: uuidV4Schema.optional(),
    limit: pageLimitSchema,
    ...exactRelationshipShape,
    ...queryBase,
  })
  .strict()
  .superRefine((query, context) => {
    try {
      assertRegisteredRelationship(
        query.edgeType,
        query.fromNodeType,
        query.toNodeType,
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["edgeType"],
        message: error instanceof Error ? error.message : "Unregistered relationship",
      });
    }
  });

const recursiveNeighborsQuerySchema = z
  .object({
    kind: z.literal("recursive-neighbors"),
    startNodeId: uuidV4Schema,
    direction: z.enum(["outgoing", "incoming"]),
    asOf: utcTimestampSchema,
    maxDepth: z.number().int().min(1).max(8),
    maxResults: z.number().int().min(1).max(500).default(200),
    ...exactRelationshipShape,
    ...queryBase,
  })
  .strict()
  .superRefine((query, context) => {
    try {
      assertRegisteredRelationship(
        query.edgeType,
        query.fromNodeType,
        query.toNodeType,
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["edgeType"],
        message: error instanceof Error ? error.message : "Unregistered relationship",
      });
    }
  });

export const graphQuerySchema = z.discriminatedUnion("kind", [
  nodeGetQuerySchema,
  nodeListQuerySchema,
  edgeNeighborsQuerySchema,
  recursiveNeighborsQuerySchema,
]);

export type GraphQuery = z.infer<typeof graphQuerySchema>;

export function parseGraphQuery(value: unknown): GraphQuery {
  return graphQuerySchema.parse(value);
}
