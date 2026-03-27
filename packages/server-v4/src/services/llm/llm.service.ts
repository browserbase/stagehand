import { constants } from "../../constants.js";
import type { DatabaseClient } from "../../db/client.js";
import { llmConfigs } from "../../db/schema/index.js";
import {
  llmConfigInsertSchema,
  llmConfigUpdateSchema,
  type LLMConfigSelect,
} from "../../db/schema/zod.js";
import type {
  LLMCreateRequest,
  LLMUpdateRequest,
} from "../../schemas/v4/llm.js";
import { LlmConfigRepository } from "../../repositories/llm/llmConfig.repository.js";

function notFoundError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

export interface LlmServiceDependencies {
  db: DatabaseClient;
  llmConfigRepository: LlmConfigRepository;
}

type LlmConfigInsertRow = typeof llmConfigs.$inferInsert;
type LlmConfigUpdateRow = Partial<LlmConfigInsertRow>;

export class LlmService {
  constructor(private readonly dependencies: LlmServiceDependencies) {}

  async listLlms(): Promise<LLMConfigSelect[]> {
    return this.dependencies.llmConfigRepository.list();
  }

  async getLlm(id: string): Promise<LLMConfigSelect> {
    const llm = await this.dependencies.llmConfigRepository.getById(id);

    if (!llm) {
      throw notFoundError("LLM not found");
    }

    return llm;
  }

  async createLlm(input: LLMCreateRequest): Promise<LLMConfigSelect> {
    const values = llmConfigInsertSchema.parse({
      ...input,
      source: "user",
    }) as unknown as LlmConfigInsertRow;

    return this.dependencies.llmConfigRepository.create(values);
  }

  async createSystemDefaultLlm(): Promise<LLMConfigSelect> {
    const values = llmConfigInsertSchema.parse({
      source: "system-default",
      displayName: constants.llm.defaultDisplayName,
      modelName: constants.llm.defaultModelName,
    }) as unknown as LlmConfigInsertRow;

    return this.dependencies.llmConfigRepository.create(values);
  }

  async updateLlm(
    id: string,
    input: LLMUpdateRequest,
  ): Promise<LLMConfigSelect> {
    await this.getLlm(id);

    const values = llmConfigUpdateSchema
      .omit({
        id: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      })
      .parse(input) as unknown as LlmConfigUpdateRow;

    const llm = await this.dependencies.llmConfigRepository.updateById(
      id,
      values,
    );

    if (!llm) {
      throw notFoundError("LLM not found");
    }

    return llm;
  }
}

// TODO(sam): when we add execution-focused endpoints, this service layer should
// call into packages/core to perform the actual model execution and persist the
// related llm_sessions / llm_calls rows. For now `/v4/llms` is config-only.
