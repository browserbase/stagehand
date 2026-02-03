import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

export interface ActionMappingOptions {
  toolCallName: string;
  toolResult: unknown;
  args: Record<string, unknown>;
  reasoning?: string;
}

/**
 * Internal provider options type used by the AI SDK.
 * This is the full provider options type used internally after merging
 * user's thinking options with internal defaults (e.g., mediaResolution for Gemini 3).
 * @internal
 */
export interface AgentProviderOptions {
  google?: GoogleGenerativeAIProviderOptions;
  anthropic?: AnthropicProviderOptions;
  openai?: OpenAIResponsesProviderOptions;
  [key: string]:
    | GoogleGenerativeAIProviderOptions
    | AnthropicProviderOptions
    | OpenAIResponsesProviderOptions
    | undefined;
}
