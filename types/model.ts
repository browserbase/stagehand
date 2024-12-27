import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { ChatCompletionTool as OpenAITool } from "openai/resources";
import { z } from "zod";

export const AvailableModelSchema = z.enum([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-08-06",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "o1-mini",
  "o1-preview",
]);

export type AvailableModel = z.infer<typeof AvailableModelSchema>;

export type ModelProvider = "openai" | "anthropic";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export type ToolCall = OpenAITool;

export type AnthropicTransformedResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export interface AnthropicJsonSchemaObject {
  definitions?: {
    MySchema?: { properties?: Record<string, unknown>; required?: string[] };
  };
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface LLMUsageEntry {
  functionName: string; // e.g. "act", "extract", "observe"
  modelName: string; // e.g. "gpt-4o", "claude-3-5-sonnet-2024..."
  promptTokens: number; // input/prompt tokens used
  completionTokens: number; // output/completion tokens used
  totalTokens: number; // total tokens for the call
  timestamp: number; // Date.now() timestamp
}
