import { Readable } from "node:stream";
import { uuidV4Schema } from "@vulto/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../auth/config.js";
import { parseDeviceId } from "../auth/device-unlock.js";
import {
  device,
  deviceUnlockSecret,
  member,
  organization,
  user,
} from "../auth/schema.js";
import { db } from "../db.js";

/**
 * The authenticated shape proxy (A003-T72). Devices reach Electric only through
 * this route. It sets the table, the where clause and its parameters on the
 * server, from the verified session, and a client supplies none of them. Exactly
 * two templates exist — nodes and edges, each filtered by the person's sync
 * audience — and no other shape can be requested.
 */

export const SHAPE_TEMPLATES = {
  nodes: {
    table: "graph_nodes",
    where:
      "workspace_id = $1 AND node_id IN (SELECT node_id FROM sync_node_audience WHERE workspace_id = $1 AND user_id = $2)",
  },
  edges: {
    table: "graph_edges",
    where:
      "workspace_id = $1 AND edge_id IN (SELECT edge_id FROM sync_edge_audience WHERE workspace_id = $1 AND user_id = $2)",
  },
} as const;

export type ShapeTemplate = keyof typeof SHAPE_TEMPLATES;

/** Electric's protocol parameters, the only query parameters a client may send. */
export const FORWARDED_PARAMETERS = [
  "offset",
  "handle",
  "live",
  "cursor",
  "expired_handle",
  "cache-buster",
] as const;

export const WORKSPACE_HEADER = "x-vulto-workspace-id";
export const DEVICE_HEADER = "x-vulto-device-id";

export interface ShapeProxyConfig {
  readonly electricUrl: string;
  readonly electricSecret: string;
}

export function buildUpstreamUrl(
  template: ShapeTemplate,
  workspaceId: string,
  userId: string,
  forwarded: Readonly<Record<string, string>>,
  config: ShapeProxyConfig,
): URL {
  const definition = SHAPE_TEMPLATES[template];
  const url = new URL("/v1/shape", config.electricUrl);
  url.searchParams.set("table", definition.table);
  url.searchParams.set("where", definition.where);
  url.searchParams.set("params[1]", workspaceId);
  url.searchParams.set("params[2]", userId);
  for (const name of FORWARDED_PARAMETERS) {
    const value = forwarded[name];
    if (value !== undefined) url.searchParams.set(name, value);
  }
  url.searchParams.set("secret", config.electricSecret);
  return url;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "upgrade",
  "set-cookie",
]);

const REVOKED_BODY = { code: "access-revoked", erase: true } as const;

/** The person's device is revoked, or the person no longer holds the membership. */
async function accessRevoked(input: {
  readonly userId: string;
  readonly workspaceId: string;
  readonly deviceId: string;
}): Promise<boolean> {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
      ),
    )
    .limit(1);
  if (!membership) return true;

  const [registered] = await db
    .select({ isRevoked: device.isRevoked })
    .from(device)
    .where(and(eq(device.id, input.deviceId), eq(device.userId, input.userId)))
    .limit(1);
  if (!registered || registered.isRevoked) return true;

  // An Owner's revoke of one device in one workspace is recorded here (F191).
  const [scoped] = await db
    .select({ id: deviceUnlockSecret.deviceId })
    .from(deviceUnlockSecret)
    .where(
      and(
        eq(deviceUnlockSecret.deviceId, input.deviceId),
        eq(deviceUnlockSecret.workspaceId, input.workspaceId),
        eq(deviceUnlockSecret.userId, input.userId),
        isNotNull(deviceUnlockSecret.revokedAt),
      ),
    )
    .limit(1);
  return scoped !== undefined;
}

function toHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

export interface ShapeProxyOptions {
  readonly config?: () => ShapeProxyConfig | null;
  readonly fetch?: typeof fetch;
}

function configFromEnv(): ShapeProxyConfig | null {
  const electricUrl = process.env["ELECTRIC_URL"];
  const electricSecret = process.env["ELECTRIC_SECRET"];
  return electricUrl && electricSecret ? { electricUrl, electricSecret } : null;
}

export async function registerShapeProxy(
  app: FastifyInstance,
  options: ShapeProxyOptions = {},
): Promise<void> {
  const getConfig = options.config ?? configFromEnv;
  const doFetch = options.fetch ?? fetch;

  app.get(
    "/v1/shape/:template",
    async (
      request: FastifyRequest<{ Params: { template: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header("Cache-Control", "private, no-store");

      const templateName = request.params.template;
      if (!Object.hasOwn(SHAPE_TEMPLATES, templateName)) {
        return reply.code(404).send({ code: "unknown-shape" });
      }
      const template = templateName as ShapeTemplate;

      // A client supplies no table, where, columns or params, and nothing else
      // beyond Electric's own protocol parameters.
      const forwarded: Record<string, string> = {};
      const allowed = new Set<string>(FORWARDED_PARAMETERS);
      for (const [name, value] of Object.entries(
        request.query as Record<string, unknown>,
      )) {
        if (!allowed.has(name) || typeof value !== "string") {
          return reply
            .code(400)
            .send({ code: "invalid-shape-parameter", parameter: name });
        }
        forwarded[name] = value;
      }

      const headers = toHeaders(request.headers);
      const current = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      });
      if (!current) return reply.code(401).send({ code: "unauthenticated" });

      let workspaceId: string;
      let deviceId: string;
      try {
        workspaceId = uuidV4Schema.parse(headers.get(WORKSPACE_HEADER));
        deviceId = parseDeviceId(headers.get(DEVICE_HEADER));
      } catch {
        return reply.code(400).send({ code: "invalid-request" });
      }

      const userId = current.user.id;
      if (await accessRevoked({ userId, workspaceId, deviceId })) {
        return reply.code(401).send(REVOKED_BODY);
      }

      const config = getConfig();
      if (!config) return reply.code(503).send({ code: "sync-unavailable" });

      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());
      let upstream: Response;
      try {
        upstream = await doFetch(
          buildUpstreamUrl(template, workspaceId, userId, forwarded, config),
          {
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        );
      } catch {
        return reply.code(502).send({ code: "sync-unavailable" });
      }

      reply.code(upstream.status);
      for (const [name, value] of upstream.headers) {
        if (
          !HOP_BY_HOP.has(name.toLowerCase()) &&
          !name.toLowerCase().startsWith("access-control-")
        ) {
          reply.header(name, value);
        }
      }
      // Never cacheable across people, whatever Electric said.
      reply.header("Cache-Control", "private, no-store");
      reply.header("Vary", "Cookie");
      if (upstream.body === null) return reply.send();
      return reply.send(Readable.fromWeb(upstream.body as never));
    },
  );
}
