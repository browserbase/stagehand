import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { z } from "zod/v3";

export const AvailableModelSchema = z.enum([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "o4-mini",
  "o3",
  "o3-mini",
  "o1",
  "o1-mini",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-08-06",
  "gpt-4.5-preview",
  "o1-preview",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-7-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "cerebras-llama-3.3-70b",
  "cerebras-llama-3.1-8b",
  "groq-llama-3.3-70b-versatile",
  "groq-llama-3.3-70b-specdec",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash-preview-04-17",
  "gemini-2.5-pro-preview-03-25",
]);

export type AvailableModel = z.infer<typeof AvailableModelSchema> | string;

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "cerebras"
  | "groq"
  | "google"
  | "aisdk";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export interface AnthropicJsonSchemaObject {
  definitions?: {
    MySchema?: { properties?: Record<string, unknown>; required?: string[] };
  };
  properties?: Record<string, unknown>;
  required?: string[];
}
