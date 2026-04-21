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
    // Single-row create, so we do not need a transaction yet.
    // TODO: swap this stub for the real packages/core implementation.
    const values = await this.buildStubUserLlmConfig(input);

    return this.dependencies.llmConfigRepository.create(values);
  }

  async createSystemDefaultLlm(): Promise<LLMConfigSelect> {
    // Single-row create, so we do not need a transaction yet.
    // TODO: swap this stub for the real packages/core implementation.
    const values = await this.buildStubSystemDefaultLlmConfig();

    return this.dependencies.llmConfigRepository.create(values);
  }

  async updateLlm(
    id: string,
    input: LLMUpdateRequest,
  ): Promise<LLMConfigSelect> {
    await this.getLlm(id);

    // Single-row update, so we do not need a transaction yet.
    // TODO: swap this stub for the real packages/core implementation.
    const values = await this.buildStubLlmConfigUpdate(input);

    const llm = await this.dependencies.llmConfigRepository.updateById(
      id,
      values,
    );

    if (!llm) {
      throw notFoundError("LLM not found");
    }

    return llm;
  }

  private async buildStubUserLlmConfig(
    input: LLMCreateRequest,
  ): Promise<LlmConfigInsertRow> {
    return llmConfigInsertSchema.parse({
      ...input,
      source: "user",
    }) as unknown as LlmConfigInsertRow;
  }

  private async buildStubSystemDefaultLlmConfig(): Promise<LlmConfigInsertRow> {
    return llmConfigInsertSchema.parse({
      source: "system-default",
      displayName: constants.llm.defaultDisplayName,
      modelName: constants.llm.defaultModelName,
    }) as unknown as LlmConfigInsertRow;
  }

  private async buildStubLlmConfigUpdate(
    input: LLMUpdateRequest,
  ): Promise<LlmConfigUpdateRow> {
    return llmConfigUpdateSchema
      .omit({
        id: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      })
      .parse(input) as unknown as LlmConfigUpdateRow;
  }
}
