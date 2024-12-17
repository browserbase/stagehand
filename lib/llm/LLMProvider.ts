import { LogLine } from "../../types/log";
import {
  AvailableModel,
  ClientOptions,
  ModelProvider,
} from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";
import { OpenAIClient } from "./OpenAIClient";

export class LLMProvider {
  // This function is only ran if a modelName is not specified to the LLMProvider
  private getDefaultModelName() {
    if (!!process.env.OPENAI_API_KEY && !!process.env.ANTHROPIC_API_KEY) {
      return "gpt-4o"
    } else if (!!process.env.ANTHROPIC_API_KEY) {
      return "claude-3-5-sonnet-latest"
    }

    return "gpt-4o"
  }

  private modelToProviderMap: { [key in AvailableModel]: ModelProvider } = {
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "gpt-4o-2024-08-06": "openai",
    "o1-mini": "openai",
    "o1-preview": "openai",
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

  getClient(
    modelName?: AvailableModel,
    clientOptions?: ClientOptions,
  ): LLMClient {
    const model = modelName ?? this.getDefaultModelName()
    const provider = this.modelToProviderMap[model]

    if (!provider) {
      throw new Error(`Unsupported model: ${model}`);
    }

    switch (provider) {
      case "openai":
        if (!clientOptions.apiKey && !process.env.OPENAI_API_KEY)
          throw new Error('OPENAI_API_KEY is not set in environment. Please set env or use apiKey in client options')

        return new OpenAIClient(
          this.logger,
          this.enableCaching,
          this.cache,
          model,
          clientOptions,
        );
      case "anthropic":
        if (!clientOptions.apiKey && !process.env.ANTHROPIC_API_KEY)
          throw new Error('ANTHROPIC_API_KEY is not set in environment. Please set env or use apiKey in client options')

        return new AnthropicClient(
          this.logger,
          this.enableCaching,
          this.cache,
          model,
          clientOptions,
        );
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
