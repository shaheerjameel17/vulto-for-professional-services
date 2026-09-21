import { Readable } from "node:stream";
import { DEVICE_HEADER, uuidV4Schema, WORKSPACE_HEADER } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../auth/config.js";
import { touchDeviceActivity } from "../auth/device-registry.js";
import {
  isDeviceRevokedInWorkspace,
  parseDeviceId,
} from "../auth/device-revocation-store.js";
import { device, member, organization, user } from "../auth/schema.js";
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
  "log",
] as const;

/** Parameters that may only carry one value: `log=full` is the client's default and narrows nothing. */
const FIXED_VALUES: Readonly<Record<string, string>> = { log: "full" };

export { DEVICE_HEADER, WORKSPACE_HEADER };

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

/** The one reply for every kind of lost access. Byte-identical by construction. */
const REVOKED_JSON = JSON.stringify({ code: "access-revoked", erase: true });

const NIL_UUID = "00000000-0000-4000-8000-000000000000";
const NIL_DEVICE = "0".repeat(32);

/** A malformed key becomes one that matches nothing, so it takes the same path as an unknown one. */
function asWorkspaceKey(value: string | null): string {
  return uuidV4Schema.safeParse(value).success ? (value as string) : NIL_UUID;
}

function asDeviceKey(value: string | null): string {
  try {
    return parseDeviceId(value);
  } catch {
    return NIL_DEVICE;
  }
}

/**
 * True unless the person holds an active membership in the workspace AND the
 * device is registered to them and not revoked, globally or for this workspace.
 * All three checks always run, so the work done does not depend on which one
 * fails.
 */
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

  const [registered] = await db
    .select({ isRevoked: device.isRevoked })
    .from(device)
    .where(and(eq(device.id, input.deviceId), eq(device.userId, input.userId)))
    .limit(1);

  // An Owner's revoke of one device in one workspace, a removal and a
  // suspension are all recorded in `device_workspace_revocation` (F191, F210).
  const scoped = await isDeviceRevokedInWorkspace(
    db,
    input.workspaceId,
    input.deviceId,
  );

  return !membership || !registered || registered.isRevoked || scoped;
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
  // Looked up per call, so a test may replace the global fetch after the server is built.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);

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
        if (
          !allowed.has(name) ||
          typeof value !== "string" ||
          (Object.hasOwn(FIXED_VALUES, name) && FIXED_VALUES[name] !== value)
        ) {
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

      // The workspace header is a lookup key, never authorization. Whatever it
      // holds is checked against the session user's membership on every request,
      // and every way of not being an active member (removed, suspended, never a
      // member, no such workspace, a malformed id) gets the identical reply. The
      // same queries run in every case, so nothing branches on whether the
      // workspace exists.
      const userId = current.user.id;
      const workspaceId = asWorkspaceKey(headers.get(WORKSPACE_HEADER));
      const deviceId = asDeviceKey(headers.get(DEVICE_HEADER));
      if (await accessRevoked({ userId, workspaceId, deviceId })) {
        return reply
          .code(401)
          .header("Content-Type", "application/json")
          .send(REVOKED_JSON);
      }

      // The device is confirmed acceptable right now, which is what "active" means.
      void touchDeviceActivity(deviceId).catch(() => undefined);

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
