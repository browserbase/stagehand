import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { z } from "zod";

// Create a base schema for specific known models
const BaseModelSchema = z.enum([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-08-06",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-7-sonnet-20250219",
  "o1-mini",
  "o1-preview",
  "o3-mini",
  "cerebras-llama-3.3-70b",
  "cerebras-llama-3.1-8b",
]);

// Create a schema that also accepts any string starting with "braintrust-"
export const AvailableModelSchema = z.union([
  BaseModelSchema,
  z.string().refine((val) => val.startsWith("braintrust-"), {
    message: "Braintrust models must start with 'braintrust-'",
  }),
]);

export type AvailableModel = z.infer<typeof AvailableModelSchema>;

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "cerebras"
  | "braintrust"
  | "groq";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export interface AnthropicJsonSchemaObject {
  definitions?: {
    MySchema?: { properties?: Record<string, unknown>; required?: string[] };
  };
  properties?: Record<string, unknown>;
  required?: string[];
}
