import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertKeyProviderConfigured } from "./crypto/keys.js";
import { createContext } from "./trpc.js";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthHttp } from "./auth/http.js";
import { env } from "./env.js";
import { appRouter } from "./router.js";

function tlsOptions(): { key: Buffer; cert: Buffer } | undefined {
  if (!env.API_TLS_CERT_PATH || !env.API_TLS_KEY_PATH) return undefined;
  return {
    key: readFileSync(env.API_TLS_KEY_PATH),
    cert: readFileSync(env.API_TLS_CERT_PATH),
  };
}

/**
 * Never log credentials (A006-T12). Request bodies are not logged at all, so a
 * protected value cannot appear in a request line; headers that carry a session
 * or token are redacted.
 */
const LOG_REDACT = {
  paths: [
    "req.headers.cookie",
    "req.headers.authorization",
    'res.headers["set-cookie"]',
  ],
  censor: "[redacted]",
};

export interface BuildServerOptions {
  /** For tests: capture log output at a chosen level. */
  readonly logger?: { readonly level: string; readonly stream: NodeJS.WritableStream };
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  // Refuse to start with a key provider that is not allowed here (A003-T73).
  assertKeyProviderConfigured();
  const tls = tlsOptions();
  const logger = {
    level: options.logger?.level ?? env.LOG_LEVEL,
    redact: LOG_REDACT,
    ...(options.logger ? { stream: options.logger.stream } : {}),
  };
  const app = (tls
    ? Fastify({ logger, https: tls })
    : Fastify({ logger })) as unknown as FastifyInstance;

  app.decorate("vultoApiOrigin", env.API_ORIGIN);
  app.decorate("vultoTrustedOrigins", new Set(env.AUTH_TRUSTED_ORIGINS));

  await app.register(cors, {
    origin: [...env.AUTH_TRUSTED_ORIGINS],
    credentials: true,
  });

  await registerAuthHttp(app);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  app.get("/health", async () => ({ api: "ok" }));
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`vulto api listening on ${env.API_ORIGIN}`);
    return app;
  } catch (error) {
    app.log.error(error);
    await app.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(() => {
    process.exitCode = 1;
  });
}
