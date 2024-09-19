import { OpenAIClient } from "./OpenAIClient";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";

export class LLMProvider {
  private supportedModels: { [key: string]: string } = {
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "o1-preview": "openai",
    "o1-mini": "openai",
    "gpt-4o-2024-08-06": "openai",
    "claude-3-5-sonnet-20240620": "anthropic"
  };

  private logger: (message: { category?: string; message: string }) => void;

  constructor(logger: (message: { category?: string; message: string }) => void) {
    this.logger = logger;
  }

  getClient(modelName: string): LLMClient {
    const provider = this.supportedModels[modelName];
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