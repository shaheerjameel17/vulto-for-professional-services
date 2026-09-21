import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    vultoApiOrigin: string;
    vultoTrustedOrigins: ReadonlySet<string>;
  }
}
