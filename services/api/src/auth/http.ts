import { passkeyRegistrationInputSchema } from "@vulto/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auth } from "./config.js";
import {
  DeviceRevokeDeniedError,
  DeviceRoleRefreshDeniedError,
  DeviceUnlockDeniedError,
  parseDeviceRevokeRequest,
  parseDeviceRoleRefreshRequest,
  parseDeviceStoreUnlockRequest,
  requestDeviceRoleRefresh,
  requestDeviceUnlock,
  revokeDevice,
} from "./device-unlock.js";
import {
  enforcePasskeyRegistrationRateLimit,
  issuePasskeyRegistrationContext,
  PasskeyRegistrationRateLimitError,
} from "./passkey-registration.js";

const SENSITIVE_RESPONSE_KEYS = new Set([
  "token",
  "sessionToken",
  "accessToken",
  "refreshToken",
  "idToken",
]);

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  headers.delete("content-length");
  // Fastify resolves this from the socket because trustProxy is deliberately
  // disabled. Overwrite any caller value before Better Auth rate-limit keying.
  headers.set("x-vulto-client-ip", request.ip);
  return headers;
}

function sanitizeAuthResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuthResponse);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_RESPONSE_KEYS.has(key))
      .map(([key, nested]) => [key, sanitizeAuthResponse(nested)]),
  );
}

export async function registerAuthHttp(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/passkey/registration-context", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const origin = request.headers.origin;
    if (!origin || !app.vultoTrustedOrigins.has(origin)) {
      return reply.code(403).send({ error: "Request is not permitted" });
    }

    const parsed = passkeyRegistrationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Registration could not be started" });
    }

    try {
      await enforcePasskeyRegistrationRateLimit(request.ip);
      return await issuePasskeyRegistrationContext(parsed.data);
    } catch (error) {
      if (error instanceof PasskeyRegistrationRateLimitError) {
        return reply.code(429).send({ error: "Registration could not be started" });
      }
      return reply.code(400).send({ error: "Registration could not be started" });
    }
  });

  app.post("/device-store/unlock", async (request, reply) => {
    reply.header("cache-control", "no-store");
    let parsed: { workspaceId: string; deviceId: string };
    try {
      parsed = parseDeviceStoreUnlockRequest(request.body);
    } catch {
      return reply
        .code(401)
        .send({ error: "This device is not authorized to unlock the local store" });
    }

    try {
      const grant = await requestDeviceUnlock(
        requestHeaders(request),
        parsed.workspaceId,
        parsed.deviceId,
      );
      return grant;
    } catch (error) {
      if (error instanceof DeviceUnlockDeniedError) {
        return reply.code(401).send({ error: error.message });
      }
      request.log.error(error);
      return reply
        .code(401)
        .send({ error: "This device is not authorized to unlock the local store" });
    }
  });

  app.post("/device-store/roles", async (request, reply) => {
    reply.header("cache-control", "no-store");
    let parsed: { workspaceId: string; deviceId?: string };
    try {
      parsed = parseDeviceRoleRefreshRequest(request.body);
    } catch {
      return reply
        .code(401)
        .send({ error: "This device is not authorized to unlock the local store" });
    }

    try {
      return await requestDeviceRoleRefresh(
        requestHeaders(request),
        parsed.workspaceId,
        parsed.deviceId,
      );
    } catch (error) {
      // F151. `reason` is the classified, enumerable signal — present only
      // when a positive fact (this device's own secret, or the membership/
      // account row) confirmed one of the two named revocation events.
      // Absent for every other denial, which is reported exactly as before:
      // a plain 401 with no `revocation` field, still locking (F148's
      // tested default), never erasing.
      if (error instanceof DeviceRoleRefreshDeniedError) {
        return reply.code(401).send({
          error: error.message,
          ...(error.reason !== undefined
            ? { revocation: { kind: error.reason } }
            : {}),
        });
      }
      if (error instanceof DeviceUnlockDeniedError) {
        return reply.code(401).send({ error: error.message });
      }
      // F148. This route's answer is a DEVICE-FACING SECURITY DECISION: a
      // 401 here locks the caller's sealed local store. So an error that is
      // ours — a database outage, a driver failure, a bug — must never be
      // reported as one about the caller's authorization. It previously
      // was, which turned any infrastructure blip into a fleet-wide local
      // lockout with silent data loss (F144).
      //
      // 503 says the only true thing: we could not answer. The device
      // treats it as "try again," keeps its roles stale, and stays open.
      request.log.error(error);
      return reply
        .code(503)
        .send({ error: "The role refresh checkpoint is temporarily unavailable" });
    }
  });

  app.post("/device-store/revoke", async (request, reply) => {
    reply.header("cache-control", "no-store");
    let parsed: { workspaceId: string; deviceId: string };
    try {
      parsed = parseDeviceRevokeRequest(request.body);
    } catch {
      return reply.code(401).send({
        error: "This session is not authorized to revoke devices in this workspace",
      });
    }

    try {
      await revokeDevice(requestHeaders(request), parsed.workspaceId, parsed.deviceId);
      return reply.code(200).send({ revoked: true });
    } catch (error) {
      if (error instanceof DeviceRevokeDeniedError) {
        return reply.code(401).send({ error: error.message });
      }
      request.log.error(error);
      return reply
        .code(503)
        .send({ error: "The device revocation checkpoint is temporarily unavailable" });
    }
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, app.vultoApiOrigin);

      // FDN-85 and FDN-86 own organization mutation and invitation commands.
      // Keeping the plugin's public routes closed prevents a second write path.
      if (url.pathname.startsWith("/api/auth/organization/")) {
        return reply.code(404).send({ error: "Not found" });
      }

      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: requestHeaders(request),
          body:
            hasBody && request.body !== undefined
              ? JSON.stringify(request.body)
              : undefined,
        }),
      );

      reply.header("cache-control", "no-store");

      for (const [name, value] of response.headers.entries()) {
        if (
          name === "set-cookie" ||
          name === "content-length" ||
          name === "content-encoding" ||
          name === "connection"
        ) {
          continue;
        }
        reply.header(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      reply.code(response.status);
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const text = await response.text();
        if (!text) return reply.send();
        return reply.send(sanitizeAuthResponse(JSON.parse(text)));
      }

      const body = await response.arrayBuffer();
      return reply.send(body.byteLength > 0 ? Buffer.from(body) : undefined);
    },
  });
}
