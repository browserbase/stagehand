import { OpenAIClient } from "./OpenAIClient";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";

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

  private logger: (message: { category?: string; message: string }) => void;

  constructor(
    logger: (message: { category?: string; message: string }) => void,
  ) {
    this.logger = logger;
  }

  getClient(modelName: AvailableModel): LLMClient {
    const provider = this.modelToProviderMap[modelName];
    if (!provider) {
      throw new Error(`Unsupported model: ${modelName}`);
    }

    switch (provider) {
      case "openai":
        return new OpenAIClient(this.logger);
      case "anthropic":
        return new AnthropicClient(this.logger);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
