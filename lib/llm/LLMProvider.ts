import { OpenAIClient } from "./OpenAIClient";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";
import { LLMCache } from "../cache/LLMCache";
import { LogLine } from "../types";

export type AvailableModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4o-2024-08-06"
  | "claude-3-5-sonnet-latest"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-sonnet-20240620";

export class LLMProvider {
  private modelToProviderMap: { [key in AvailableModel]: string } = {
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "gpt-4o-2024-08-06": "openai",
    "claude-3-5-sonnet-latest": "anthropic",
    "claude-3-5-sonnet-20240620": "anthropic",
    "claude-3-5-sonnet-20241022": "anthropic",
  };

  private logger: (message: LogLine) => void;
  private enableCaching: boolean;
  private cache: LLMCache | undefined;

  constructor(logger: (message: LogLine) => void, enableCaching: boolean) {
    this.logger = logger;
    this.enableCaching = enableCaching;
    this.cache = enableCaching ? new LLMCache(logger) : undefined;
  }

  cleanRequestCache(requestId: string): void {
    if (!this.enableCaching) {
      return;
    }

    this.logger({
      category: "llm_cache",
      message: "cleaning up cache",
      level: 1,
      auxiliary: {
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });
    this.cache.deleteCacheForRequestId(requestId);
  }

  getClient(modelName: AvailableModel, requestId: string): LLMClient {
    const provider = this.modelToProviderMap[modelName];
    if (!provider) {
      throw new Error(`Unsupported model: ${modelName}`);
    }

    switch (provider) {
      case "openai":
        return new OpenAIClient(
          this.logger,
          this.enableCaching,
          this.cache,
          requestId,
        );
      case "anthropic":
        return new AnthropicClient(
          this.logger,
          this.enableCaching,
          this.cache,
          requestId,
        );
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}

export const resolveLLMClient = ({
  llmProvider,
  modelName,
  requestId,
}: {
  llmProvider?: LLMProvider;
  modelName?: AvailableModel;
  requestId?: string;
}) => {
  if (!llmProvider || !modelName || !requestId) {
    throw new Error(
      "Either llmProvider, modelName, and requestId must be provided",
    );
  }
  return llmProvider.getClient(modelName, requestId);
};
