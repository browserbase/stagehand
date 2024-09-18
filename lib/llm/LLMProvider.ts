import { OpenAIClient } from "./OpenAIClient";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";

export class LLMProvider {
  private supportedModels: { [key: string]: string } = {
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "o1-preview": "openai",
    "o1-mini": "openai",
    // Add Anthropic models here
  };

  getClient(modelName: string): LLMClient {
    const provider = this.supportedModels[modelName];
    if (!provider) {
      throw new Error(`Unsupported model: ${modelName}`);
    }

    switch (provider) {
      case "openai":
        return new OpenAIClient();
      case "anthropic":
        return new AnthropicClient(/* Credentials */);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}