import type { LanguageModel, LanguageModelMiddleware } from "ai";
import {
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors.js";
import { LogLine } from "../types/public/logs.js";
import { AvailableModel, ClientOptions, ModelProvider } from "../types/public/model.js";
import {
  ApiKeyResolvedProviderClientOptionsSchema,
  ClientOptionsSchema,
  ResolvedProviderClientOptionsSchema,
} from "../types/public/schemas.js";
import { AISdkClient } from "./aisdk.js";
import { AnthropicClient } from "./AnthropicClient.js";
import { CerebrasClient } from "./CerebrasClient.js";
import { GoogleClient } from "./GoogleClient.js";
import { GroqClient } from "./GroqClient.js";
import { LLMClient } from "./LLMClient.js";
import { OpenAIClient } from "./OpenAIClient.js";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { bedrock, createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { vertex, createVertex } from "@ai-sdk/google-vertex";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { xai, createXai } from "@ai-sdk/xai";
import { azure, createAzure } from "@ai-sdk/azure";
import { groq, createGroq } from "@ai-sdk/groq";
import { cerebras, createCerebras } from "@ai-sdk/cerebras";
import { togetherai, createTogetherAI } from "@ai-sdk/togetherai";
import { mistral, createMistral } from "@ai-sdk/mistral";
import { deepseek, createDeepSeek } from "@ai-sdk/deepseek";
import { perplexity, createPerplexity } from "@ai-sdk/perplexity";
import { ollama, createOllama } from "ollama-ai-provider-v2";
import { gateway, createGateway, wrapLanguageModel } from "ai";

// Compile-only bridge: current AI SDK providers return mixed v2/v3/v4 model
// types, while copied V3 code assumed a single provider model type.
type AISDKProvider = (modelName: string) => LanguageModel;
type AISDKCustomProvider = (options: Record<string, unknown>) => AISDKProvider;

const AISDKProviders: Record<string, AISDKProvider> = {
  openai: openai as AISDKProvider,
  bedrock: bedrock as AISDKProvider,
  anthropic: anthropic as AISDKProvider,
  google: google as AISDKProvider,
  xai: xai as AISDKProvider,
  azure: azure as AISDKProvider,
  groq: groq as AISDKProvider,
  cerebras: cerebras as AISDKProvider,
  togetherai: togetherai as AISDKProvider,
  mistral: mistral as AISDKProvider,
  deepseek: deepseek as AISDKProvider,
  perplexity: perplexity as AISDKProvider,
  ollama: ollama as AISDKProvider,
  vertex: vertex as AISDKProvider,
  gateway: gateway as AISDKProvider,
};
const AISDKProvidersWithAPIKey: Record<string, AISDKCustomProvider> = {
  openai: createOpenAI as AISDKCustomProvider,
  bedrock: createAmazonBedrock as AISDKCustomProvider,
  anthropic: createAnthropic as AISDKCustomProvider,
  google: createGoogleGenerativeAI as AISDKCustomProvider,
  vertex: createVertex as AISDKCustomProvider,
  xai: createXai as AISDKCustomProvider,
  azure: createAzure as AISDKCustomProvider,
  groq: createGroq as AISDKCustomProvider,
  cerebras: createCerebras as AISDKCustomProvider,
  togetherai: createTogetherAI as AISDKCustomProvider,
  mistral: createMistral as AISDKCustomProvider,
  deepseek: createDeepSeek as AISDKCustomProvider,
  perplexity: createPerplexity as AISDKCustomProvider,
  ollama: createOllama as AISDKCustomProvider,
  gateway: createGateway as AISDKCustomProvider,
};

type AISDKProviderClientOptions = ClientOptions & Record<string, unknown>;

function parseClientOptions(clientOptions?: ClientOptions): ClientOptions {
  return ClientOptionsSchema.parse(clientOptions);
}

function parseApiKeyProviderClientOptions(provider: string, clientOptions?: ClientOptions) {
  return ApiKeyResolvedProviderClientOptionsSchema.parse({
    provider,
    clientOptions: parseClientOptions(clientOptions),
  }).clientOptions;
}

export function toAISDKClientOptions(
  subProvider: string,
  clientOptions?: ClientOptions,
): AISDKProviderClientOptions | undefined {
  const resolvedProviderConfig = ResolvedProviderClientOptionsSchema.parse({
    provider: subProvider,
    clientOptions: parseClientOptions(clientOptions),
  });

  const { auth, providerOptions, ...rest } = resolvedProviderConfig.clientOptions;
  delete rest.provider;
  const apiKeyOption = auth?.type === "apiKey" ? { apiKey: auth.apiKey } : {};

  if (subProvider === "azure") {
    const azureOptions = providerOptions?.type === "azure" ? providerOptions.options : undefined;

    return {
      ...rest,
      ...apiKeyOption,
      ...azureOptions,
      ...(auth?.type === "azureEntraId" ? { tokenProvider: async () => auth.token } : {}),
    };
  }

  if (subProvider !== "vertex") {
    const options = {
      ...rest,
      ...apiKeyOption,
    };

    return Object.values(options).some((value) => value !== undefined && value !== null)
      ? options
      : undefined;
  }

  const vertexOptions = providerOptions?.type === "vertex" ? providerOptions.options : undefined;

  return {
    ...rest,
    ...vertexOptions,
    ...(auth?.type === "googleServiceAccount"
      ? {
          googleAuthOptions: {
            credentials: auth.credentials,
            ...(auth.scopes ? { scopes: auth.scopes } : {}),
            ...(auth.projectId ? { projectId: auth.projectId } : {}),
            ...(auth.universeDomain ? { universeDomain: auth.universeDomain } : {}),
          },
        }
      : {}),
  };
}

const modelToProviderMap: { [key in AvailableModel]: ModelProvider } = {
  "gpt-4.1": "openai",
  "gpt-4.1-mini": "openai",
  "gpt-4.1-nano": "openai",
  "o4-mini": "openai",
  //prettier-ignore
  "o3": "openai",
  "o3-mini": "openai",
  //prettier-ignore
  "o1": "openai",
  "o1-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4o-2024-08-06": "openai",
  "gpt-4.5-preview": "openai",
  "o1-preview": "openai",
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
  "gemini-3.5-flash": "google",
};

export function getAISDKLanguageModel(
  subProvider: string,
  subModelName: string,
  clientOptions?: ClientOptions,
  middleware?: LanguageModelMiddleware,
) {
  const aiSdkClientOptions = toAISDKClientOptions(subProvider, clientOptions);
  const hasValidOptions =
    aiSdkClientOptions &&
    Object.values(aiSdkClientOptions).some((v) => v !== undefined && v !== null);

  let model;
  if (hasValidOptions) {
    const creator = AISDKProvidersWithAPIKey[subProvider];
    if (!creator) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProvidersWithAPIKey),
      );
    }
    const provider = creator(aiSdkClientOptions);
    model = provider(subModelName);
  } else {
    const provider = AISDKProviders[subProvider];
    if (!provider) {
      throw new UnsupportedAISDKModelProviderError(subProvider, Object.keys(AISDKProviders));
    }
    model = provider(subModelName);
  }

  if (middleware) {
    return wrapLanguageModel({ model: model as never, middleware });
  }
  return model;
}

export class LLMProvider {
  private logger: (message: LogLine) => void;
  private middleware?: LanguageModelMiddleware;

  constructor(logger: (message: LogLine) => void, middleware?: LanguageModelMiddleware) {
    this.logger = logger;
    this.middleware = middleware;
  }

  getClient(
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
    options?: {
      experimental?: boolean;
      disableAPI?: boolean;
      middleware?: LanguageModelMiddleware;
    },
  ): LLMClient {
    const parsedClientOptions = parseClientOptions(clientOptions);

    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      const subModelName = modelName.substring(firstSlashIndex + 1);

      const effectiveMiddleware = options?.middleware ?? this.middleware;
      const languageModel = getAISDKLanguageModel(
        subProvider,
        subModelName,
        parsedClientOptions,
        effectiveMiddleware,
      );

      return new AISdkClient({
        model: languageModel,
        logger: this.logger,
        clientOptions: parsedClientOptions,
      });
    }

    // Model name doesn't include "/" - this format is deprecated
    const provider = modelToProviderMap[modelName];
    if (!provider) {
      throw new UnsupportedModelError(Object.keys(modelToProviderMap));
    }

    this.logger({
      category: "llm",
      message: `Deprecation warning: Model format "${modelName}" is deprecated. Please use the provider/model format (e.g., "openai/gpt-5" or "anthropic/claude-sonnet-4").`,
      level: 0,
    });

    const availableModel = modelName as AvailableModel;
    // Compile-only bridge: legacy clients expect provider-specific SDK options.
    switch (provider) {
      case "openai":
        return new OpenAIClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions: parseApiKeyProviderClientOptions(provider, parsedClientOptions),
        });
      case "anthropic":
        return new AnthropicClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions: parseApiKeyProviderClientOptions(provider, parsedClientOptions),
        });
      case "cerebras":
        return new CerebrasClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions: parseApiKeyProviderClientOptions(provider, parsedClientOptions),
        });
      case "groq":
        return new GroqClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions: parseApiKeyProviderClientOptions(provider, parsedClientOptions),
        });
      case "google":
        return new GoogleClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions: parseApiKeyProviderClientOptions(provider, parsedClientOptions),
        });
      default:
        // This default case handles unknown providers that exist in modelToProviderMap
        // but aren't implemented in the switch. This is an internal consistency issue.
        throw new UnsupportedModelProviderError([...new Set(Object.values(modelToProviderMap))]);
    }
  }

  static getModelProvider(modelName: AvailableModel): ModelProvider | "aisdk" {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      if (AISDKProviders[subProvider]) {
        return "aisdk";
      }
    }
    const provider = modelToProviderMap[modelName];
    return provider;
  }
}
