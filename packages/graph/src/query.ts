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

const deviceQuerySchema = z.discriminatedUnion("name", [
  z
    .object({
      kind: z.literal("device-query"),
      name: z.literal("employee.listForDirectory"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device-query"),
      name: z.literal("employee.get"),
      args: z.object({ employee_id: uuidV4Schema }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device-query"),
      name: z.literal("notification.listForUser"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device-query"),
      name: z.literal("notification.unreadActionCount"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device-query"),
      name: z.literal("search.query"),
      args: z
        .object({
          text: z.string(),
          limit: z.number().int().min(0).max(200).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const graphQuerySchema = z.discriminatedUnion("kind", [
  nodeGetQuerySchema,
  nodeListQuerySchema,
  edgeNeighborsQuerySchema,
  recursiveNeighborsQuerySchema,
  deviceQuerySchema,
]);

export type GraphQuery = z.infer<typeof graphQuerySchema>;

export const notificationListForUserQuery = () =>
  ({ kind: "device-query", name: "notification.listForUser" }) as const;
export const employeeListForDirectoryQuery = () =>
  ({ kind: "device-query", name: "employee.listForDirectory" }) as const;
export const employeeGetQuery = (employeeId: string) =>
  ({
    kind: "device-query",
    name: "employee.get",
    args: { employee_id: employeeId },
  }) as const;
export const notificationUnreadActionCountQuery = () =>
  ({ kind: "device-query", name: "notification.unreadActionCount" }) as const;
export const searchDeviceQuery = (text: string, limit?: number) =>
  ({
    kind: "device-query",
    name: "search.query",
    args: { text, ...(limit === undefined ? {} : { limit }) },
  }) as const;

export function parseGraphQuery(value: unknown): GraphQuery {
  return graphQuerySchema.parse(value);
}
