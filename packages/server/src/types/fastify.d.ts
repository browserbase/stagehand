import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    metrics: {
      startTime: number;
    };
  }
}
