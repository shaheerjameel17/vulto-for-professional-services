import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env.js";
import { appRouter } from "./router.js";

/**
 * The Vulto API server, per VPS-A001: tRPC over Fastify.
 *
 * FDN-47 stands this up as the far end of the minimal end-to-end path and
 * nothing more. Authentication is FDN-60's and is deliberately absent — see the
 * note on the diagnostics route about why that is a bounded absence rather than
 * a precedent.
 */
const { API_PORT: port, API_HOST: host } = env;

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(cors, {
  origin: env.WEB_ORIGIN,
});

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter },
});

/** Liveness only. Says nothing about Postgres — `system.status` is what does. */
app.get("/health", async () => ({ api: "ok" }));

try {
  await app.listen({ port, host });
  app.log.info(`vulto api listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
