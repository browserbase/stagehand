import type { ClientOptions as AnthropicClientOptionsBase } from "@anthropic-ai/sdk";
import type { AmazonBedrockProviderSettings as AmazonBedrockProviderSettingsBase } from "@ai-sdk/amazon-bedrock";
import type { GoogleVertexProviderSettings as GoogleVertexProviderSettingsBase } from "@ai-sdk/google-vertex";
import type {
  LanguageModelV2,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";
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

export type GoogleVertexProviderSettings = Omit<
  Partial<
    Pick<GoogleVertexProviderSettingsBase, "project" | "location" | "headers">
  >,
  "headers"
> & {
  headers?: Record<string, string>;
  googleAuthOptions?: {
    credentials?: GoogleServiceAccountCredentials;
  };
};

export type BedrockProviderOptions = Partial<
  Pick<
    AmazonBedrockProviderSettingsBase,
    "region" | "accessKeyId" | "secretAccessKey" | "sessionToken"
  >
>;

export type ProviderOptions =
  | BedrockProviderOptions
  | GoogleVertexProviderSettings;

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

/**
 * Effort levels for Claude adaptive thinking.
 * Used with Claude 4.6+ models (claude-opus-4-6, claude-sonnet-4-6).
 * - "none": Disable adaptive thinking entirely
 * - "low": Claude minimizes thinking, skips for simple tasks
 * - "medium": Claude uses moderate thinking, may skip for simple queries (default)
 * - "high": Claude always thinks with deep reasoning
 * - "max": Claude always thinks with no constraints (Opus 4.6 only)
 */
export type ThinkingEffort = "none" | "low" | "medium" | "high" | "max";

export type ClientOptions = (
  | OpenAIClientOptions
  | AnthropicClientOptions
  | GoogleVertexProviderSettings
) & {
  apiKey?: string;
  provider?: AgentProviderType;
  baseURL?: string;
  /**
   * Provider-native auth/options for providers that do not fit the generic
   * apiKey/baseURL shape. Stagehand normalizes these for local runs and
   * serializes them to the hosted API wire format when env="BROWSERBASE".
   */
  providerOptions?: ProviderOptions;
  /** OpenAI organization ID */
  organization?: string;
  /** Delay between agent actions in ms */
  waitBetweenActions?: number;
  /**
   * @deprecated For Claude 4.6+ models, use `thinkingEffort` instead.
   * Anthropic thinking budget for extended thinking (used with older Claude models like 4.5).
   * Sets `thinking.type: "enabled"` with the specified `budget_tokens`.
   */
  thinkingBudget?: number;
  /**
   * Effort level for Claude adaptive thinking (Claude 4.6+ models only).
   * Uses `thinking.type: "adaptive"` with `output_config.effort`.
   * This is the recommended approach for Claude Opus 4.6 and Sonnet 4.6.
   * @see https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
   */
  thinkingEffort?: ThinkingEffort;
  /** Environment type for CUA agents (browser, mac, windows, ubuntu) */
  environment?: string;
  /** Max images for Microsoft FARA agent */
  maxImages?: number;
  /** Temperature for model inference */
  temperature?: number;
  /** Custom headers sent with every request to the provider */
  headers?: Record<string, string>;
  /** Reasoning effort for reasoning-capable models (e.g., "none", "low", "medium", "high") */
  reasoningEffort?: string;
};

export type ModelConfiguration =
  | AvailableModel
  | (ClientOptions & {
      modelName: AvailableModel;
      /**
       * Optional AI SDK middleware applied to every LanguageModelV2 created for this model.
       * Use this to intercept LLM calls for usage tracking, logging, request transforms, etc.
       *
       * Only effective when running locally (direct mode). Cannot be serialized over HTTP,
       */
      middleware?: LanguageModelV2Middleware;
    });
