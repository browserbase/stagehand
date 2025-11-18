import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { ClientOptions as OpenAIClientOptions } from "openai";

export type AnthropicJsonSchemaObject = {
  definitions?: {
    MySchema?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
  properties?: Record<string, unknown>;
  required?: string[];
} & Record<string, unknown>;

export interface LLMTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AISDKProvider = (modelName: string) => LanguageModelV2;
// Represents a function that takes options (like apiKey) and returns an AISDKProvider
export type AISDKCustomProvider = (options: {
  apiKey: string;
}) => AISDKProvider;

export const MODEL_PROVIDER_MAP = {
  "gpt-4.1": "openai",
  "gpt-4.1-mini": "openai",
  "gpt-4.1-nano": "openai",
  "o4-mini": "openai",
  //prettier-ignore
  o3: "openai",
  "o3-mini": "openai",
  //prettier-ignore
  o1: "openai",
  "o1-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4o-2024-08-06": "openai",
  "gpt-4.5-preview": "openai",
  "o1-preview": "openai",
  "claude-3-5-sonnet-latest": "anthropic",
  "claude-3-5-sonnet-20241022": "anthropic",
  "claude-3-5-sonnet-20240620": "anthropic",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-3-7-sonnet-20250219": "anthropic",
  "cerebras-llama-3.3-70b": "cerebras",
  "cerebras-llama-3.1-8b": "cerebras",
  "groq-llama-3.3-70b-versatile": "groq",
  "groq-llama-3.3-70b-specdec": "groq",
  "moonshotai/kimi-k2-instruct": "groq",
  "gemini-1.5-flash": "google",
  "gemini-1.5-pro": "google",
  "gemini-1.5-flash-8b": "google",
  "gemini-2.0-flash-lite": "google",
  "gemini-2.0-flash": "google",
  "gemini-2.5-flash-preview-04-17": "google",
  "gemini-2.5-pro-preview-03-25": "google",
} as const;

export type ModelProvider =
  | (typeof MODEL_PROVIDER_MAP)[keyof typeof MODEL_PROVIDER_MAP]
  | "aisdk";

export type KnownModel = keyof typeof MODEL_PROVIDER_MAP;
export type AvailableModel = KnownModel | string & {};


export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export type ModelConfiguration =
  | AvailableModel
  | (ClientOptions & { modelName: AvailableModel });
