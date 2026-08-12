import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { appRouter } from "./router.js";

/**
 * The Vulto API server, per VPS-A001: tRPC over Fastify.
 *
 * FDN-47 stands this up as the far end of the minimal end-to-end path and
 * nothing more. Authentication is FDN-60's and is deliberately absent — see the
 * note on the diagnostics route about why that is a bounded absence rather than
 * a precedent.
 */
const port = Number(process.env.API_PORT ?? 3101);
const host = process.env.API_HOST ?? "127.0.0.1";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:3100",
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
