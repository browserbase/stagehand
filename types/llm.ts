import { LanguageModel } from "ai";
import { ChatMessage } from "../lib/llm/LLMClient";

export interface LLMTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AISDKProvider = (modelName: string) => LanguageModel;
// Represents a function that takes options (like apiKey) and returns an AISDKProvider
export type AISDKCustomProvider = (options: {
  apiKey: string;
}) => AISDKProvider;

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMParsedResponse<T> {
  data: T;
  usage?: LLMUsage;
  promptData?: {
    calls: Array<{
      type: string;
      messages: ChatMessage[];
      system: string;
      schema: unknown;
      config: unknown;
      usage?: { prompt_tokens: number; completion_tokens: number };
    }>;
    requestId: string;
  };
}
