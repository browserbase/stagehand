import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ModelProvider } from "@browserbasehq/stagehand-protocol/types";

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
  // Extension requests originate in the browser; Anthropic requires this CORS opt-in.
  anthropic: (modelId, connection) =>
    createAnthropic({
      // The server runs inside the browser extension, so this request is
      // browser-origin. Anthropic rejects CORS requests without this explicit
      // opt-in header ("CORS requests must set
      // 'anthropic-dangerous-direct-browser-access' header"); OpenAI and
      // Google allow browser-origin calls without one.
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
  return providerFactories[provider](modelId, connection, options);
}
