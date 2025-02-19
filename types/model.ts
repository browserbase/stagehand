import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import type { ClientOptions as CerebrasClientOptions } from "@cerebras/cerebras_cloud_sdk";
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
  "o3-mini",
  "llama-3.3-70b",
  "llama-3.1-8b"
]);

export type AvailableModel = z.infer<typeof AvailableModelSchema>;

export type ModelProvider = "openai" | "anthropic" | "cerebras";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions | CerebrasClientOptions;

export interface AnthropicJsonSchemaObject {
  definitions?: {
    MySchema?: { properties?: Record<string, unknown>; required?: string[] };
  };
  properties?: Record<string, unknown>;
  required?: string[];
}
