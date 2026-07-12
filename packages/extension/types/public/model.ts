import type { z } from "zod/v4";
import {
  AnthropicClientOptionsSchema,
  ApiKeyAuthSchema,
  ApiKeyClientOptionsSchema,
  ApiKeyResolvedProviderClientOptionsSchema,
  AzureApiKeyClientOptionsSchema,
  AzureEntraClientOptionsSchema,
  AzureResolvedProviderClientOptionsSchema,
  ClientOptionsBaseSchema,
  ClientOptionsSchema,
  ModelConfigSchema,
  ModelNameSchema,
  ModelProviderOptionsSchema,
  ModelProviderSchema,
  LLMToolSchema,
  OllamaResolvedProviderClientOptionsSchema,
  OpenAIClientOptionsSchema,
  ResolvedProviderClientOptionsSchema,
  ThinkingEffortSchema,
  VertexClientOptionsSchema,
  VertexResolvedProviderClientOptionsSchema,
} from "./schemas.js";

export type OpenAIClientOptions = z.infer<typeof OpenAIClientOptionsSchema>;

export type AnthropicClientOptions = z.infer<typeof AnthropicClientOptionsSchema>;

export interface GoogleServiceAccountCredentials {
  type?: "service_account";
  projectId?: string;
  privateKeyId?: string;
  privateKey: string;
  clientEmail: string;
  clientId?: string;
  authUri?: string;
  tokenUri?: string;
  authProviderX509CertUrl?: string;
  clientX509CertUrl?: string;
  universeDomain?: string;
}

export interface GoogleServiceAccountAuth {
  type: "googleServiceAccount";
  credentials: GoogleServiceAccountCredentials;
  scopes?: string | string[];
  projectId?: string;
  universeDomain?: string;
}

export interface AzureEntraIdAuth {
  type: "azureEntraId";
  token: string;
}

export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;

export type ModelAuth = ApiKeyAuth | GoogleServiceAccountAuth | AzureEntraIdAuth;

export interface VertexProviderOptions {
  project: string;
  location: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface AzureProviderOptions {
  resourceName?: string;
  baseURL?: string;
  apiVersion?: string;
  useDeploymentBasedUrls?: boolean;
  headers?: Record<string, string>;
}

export type ModelProviderOptions = z.infer<typeof ModelProviderOptionsSchema>;

export type LLMTool = z.infer<typeof LLMToolSchema>;

export type ModelName = z.infer<typeof ModelNameSchema>;

export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/**
 * Effort levels for Claude adaptive thinking.
 * Used with Claude 4.6+ models (claude-opus-4-6, claude-sonnet-4-6).
 * - "none": Disable adaptive thinking entirely
 * - "low": Claude minimizes thinking, skips for simple tasks
 * - "medium": Claude uses moderate thinking, may skip for simple queries (default)
 * - "high": Claude always thinks with deep reasoning
 * - "xhigh": Deeper reasoning than "high" (Opus 4.7/4.8 and Fable 5 only)
 * - "max": Claude always thinks with no constraints
 */
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>;

export type ClientOptionsBase = z.infer<typeof ClientOptionsBaseSchema>;

export type ClientOptions = z.infer<typeof ClientOptionsSchema>;

export type ApiKeyClientOptions = z.infer<typeof ApiKeyClientOptionsSchema>;

export type VertexClientOptions = z.infer<typeof VertexClientOptionsSchema>;

export type AzureApiKeyClientOptions = z.infer<typeof AzureApiKeyClientOptionsSchema>;

export type AzureEntraClientOptions = z.infer<typeof AzureEntraClientOptionsSchema>;

export type ApiKeyResolvedProviderClientOptions = z.infer<
  typeof ApiKeyResolvedProviderClientOptionsSchema
>;

export type AzureResolvedProviderClientOptions = z.infer<
  typeof AzureResolvedProviderClientOptionsSchema
>;

export type VertexResolvedProviderClientOptions = z.infer<
  typeof VertexResolvedProviderClientOptionsSchema
>;

export type OllamaResolvedProviderClientOptions = z.infer<
  typeof OllamaResolvedProviderClientOptionsSchema
>;

export type ResolvedProviderClientOptions = z.infer<typeof ResolvedProviderClientOptionsSchema>;

export type ModelConfiguration = z.infer<typeof ModelConfigSchema>;
