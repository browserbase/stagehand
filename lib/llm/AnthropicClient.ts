import { LLMClient, ChatCompletionOptions, ExtractionOptions } from "./LLMClient";

export class AnthropicClient implements LLMClient {
  // Initialize Anthropic client with necessary credentials

  async createChatCompletion(options: ChatCompletionOptions) {
    // Implement chat completion using Anthropic's API
  }

  async createExtraction(options: ExtractionOptions) {
    // Implement extraction
  }
}