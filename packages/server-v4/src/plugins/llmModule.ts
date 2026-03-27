import fp from "fastify-plugin";

import { LlmController } from "../controllers/v4/llm.controller.js";
import { LlmConfigRepository } from "../repositories/llm/llmConfig.repository.js";
import { LlmService } from "../services/llm/llm.service.js";

export const llmModulePlugin = fp(
  async (app) => {
    if (!app.db) {
      throw new Error(
        "Database plugin must be registered before llmModulePlugin",
      );
    }

    const llmConfigRepository = new LlmConfigRepository(app.db);
    const llmService = new LlmService({
      db: app.db,
      llmConfigRepository,
    });
    const llmController = new LlmController(llmService);

    app.decorate("llmConfigRepository", llmConfigRepository);
    app.decorate("llmService", llmService);
    app.decorate("llmController", llmController);
  },
  {
    name: "llm-module-plugin",
    dependencies: ["database-plugin"],
  },
);
