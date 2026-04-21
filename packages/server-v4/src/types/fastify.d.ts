import "fastify";
import type { DatabaseClient, DatabaseDriver } from "../db/client.js";
import type { LlmController } from "../controllers/v4/llm.controller.js";
import type { LlmConfigRepository } from "../repositories/llm/llmConfig.repository.js";
import type { LlmService } from "../services/llm/llm.service.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DatabaseClient | null;
    dbClient: DatabaseDriver | null;
    hasDatabase: boolean;
    llmConfigRepository: LlmConfigRepository;
    llmService: LlmService;
    llmController: LlmController;
  }

  interface FastifyRequest {
    metrics: {
      startTime: number;
    };
  }
}
