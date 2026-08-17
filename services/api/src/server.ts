import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

export async function buildServer(): Promise<FastifyInstance> {
  const tls = tlsOptions();
  const app = (tls
    ? Fastify({ logger: { level: env.LOG_LEVEL }, https: tls })
    : Fastify({ logger: { level: env.LOG_LEVEL } })) as unknown as FastifyInstance;

  app.decorate("vultoApiOrigin", env.API_ORIGIN);
  app.decorate("vultoTrustedOrigins", new Set(env.AUTH_TRUSTED_ORIGINS));

  await app.register(cors, {
    origin: [...env.AUTH_TRUSTED_ORIGINS],
    credentials: true,
  });

  await registerAuthHttp(app);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter },
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
