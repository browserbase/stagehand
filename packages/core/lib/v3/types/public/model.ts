import type { ClientOptions as AnthropicClientOptionsBase } from "@anthropic-ai/sdk";
import type { GoogleVertexProviderSettings as GoogleVertexProviderSettingsBase } from "@ai-sdk/google-vertex";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { ClientOptions as OpenAIClientOptionsBase } from "openai";
import type { AgentProviderType } from "./agent.js";

export type OpenAIClientOptions = Pick<
  OpenAIClientOptionsBase,
  "baseURL" | "apiKey"
>;

export type AnthropicClientOptions = Pick<
  AnthropicClientOptionsBase,
  "baseURL" | "apiKey"
>;

export interface GoogleServiceAccountCredentials {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

export type GoogleVertexProviderSettings = Pick<
  GoogleVertexProviderSettingsBase,
  "project" | "location"
> & {
  googleAuthOptions?: {
    credentials?: GoogleServiceAccountCredentials;
  };
};

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
export type AISDKCustomProvider = (options: ClientOptions) => AISDKProvider;

export type AvailableModel =
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "o4-mini"
  | "o3"
  | "o3-mini"
  | "o1"
  | "o1-mini"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4o-2024-08-06"
  | "gpt-4.5-preview"
  | "o1-preview"
  | "claude-3-5-sonnet-latest"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-sonnet-20240620"
  | "claude-3-7-sonnet-latest"
  | "claude-3-7-sonnet-20250219"
  | "cerebras-llama-3.3-70b"
  | "cerebras-llama-3.1-8b"
  | "groq-llama-3.3-70b-versatile"
  | "groq-llama-3.3-70b-specdec"
  | "gemini-1.5-flash"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash-8b"
  | "gemini-2.0-flash-lite"
  | "gemini-2.0-flash"
  | "gemini-2.5-flash-preview-04-17"
  | "gemini-2.5-pro-preview-03-25"
  | string;

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "cerebras"
  | "groq"
  | "google"
  | "aisdk";

export type ClientOptions = (
  | OpenAIClientOptions
  | AnthropicClientOptions
  | GoogleVertexProviderSettings
) & {
  apiKey?: string;
  provider?: AgentProviderType;
  baseURL?: string;
  /** OpenAI organization ID */
  organization?: string;
  /** Delay between agent actions in ms */
  waitBetweenActions?: number;
  /** Anthropic thinking budget for extended thinking */
  thinkingBudget?: number;
  /** Environment type for CUA agents (browser, mac, windows, ubuntu) */
  environment?: string;
  /** Max images for Microsoft FARA agent */
  maxImages?: number;
  /** Temperature for model inference */
  temperature?: number;
};

export type ModelConfiguration =
  | AvailableModel
  | (ClientOptions & { modelName: AvailableModel });
