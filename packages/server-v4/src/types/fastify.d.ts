import "fastify";
import type { DatabaseClient, DatabaseDriver } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DatabaseClient | null;
    dbClient: DatabaseDriver | null;
    hasDatabase: boolean;
  }

  interface FastifyRequest {
    metrics: {
      startTime: number;
    };
  }
}
