import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ModelProvider } from "@browserbasehq/stagehand-protocol/types";
import { boundFetch } from "./boundFetch.js";

type ProviderConnection = {
  apiKey?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

type ProviderFactory = (
  modelId: string,
  connection: ProviderConnection,
  options?: { stopSequences?: readonly string[] },
) => LanguageModelV4;

const providerFactories: Record<ModelProvider, ProviderFactory> = {
  openai: (modelId, connection, options) => {
    const provider = createOpenAI(connection);
    return options?.stopSequences?.length ? provider.chat(modelId) : provider.responses(modelId);
  },
  // Browser-origin Anthropic requests require this CORS opt-in header.
  anthropic: (modelId, connection) =>
    createAnthropic({
      ...connection,
      headers: {
        ...connection.headers,
        "anthropic-dangerous-direct-browser-access": "true",
      },
    })(modelId),
  google: (modelId, connection) => createGoogleGenerativeAI(connection)(modelId),
};

export function createProviderLanguageModel(
  provider: ModelProvider,
  modelId: string,
  connection: ProviderConnection = {},
  options?: { stopSequences?: readonly string[] },
): LanguageModelV4 {
  return providerFactories[provider](modelId, { ...connection, fetch: boundFetch }, options);
}
