import type { LanguageModelV3Middleware } from "@ai-sdk/provider";
import {
  ExperimentalNotConfiguredError,
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
} from "../types/public/sdkErrors.js";
import { LogLine } from "../types/public/logs.js";
import {
  AvailableModel,
  ClientOptions,
  ModelProvider,
} from "../types/public/model.js";
import { AISdkClient } from "./aisdk.js";
import { LLMClient } from "./LLMClient.js";
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
import { AISDKProvider, AISDKCustomProvider } from "../types/public/model.js";

const AISDKProviders: Record<string, AISDKProvider> = {
  openai,
  bedrock,
  anthropic,
  google,
  xai,
  azure,
  groq,
  cerebras,
  togetherai,
  mistral,
  deepseek,
  perplexity,
  ollama,
  vertex,
  gateway,
};
const AISDKProvidersWithAPIKey: Record<string, AISDKCustomProvider> = {
  openai: createOpenAI,
  bedrock: createAmazonBedrock,
  anthropic: createAnthropic,
  google: createGoogleGenerativeAI,
  vertex: createVertex,
  xai: createXai,
  azure: createAzure,
  groq: createGroq,
  cerebras: createCerebras,
  togetherai: createTogetherAI,
  mistral: createMistral,
  deepseek: createDeepSeek,
  perplexity: createPerplexity,
  ollama: createOllama as AISDKCustomProvider,
  gateway: createGateway,
};

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
};

function getAISDKProviderModel(
  modelName: AvailableModel,
): { provider: string; model: string } | null {
  if (modelName.includes("/")) {
    const firstSlashIndex = modelName.indexOf("/");
    return {
      provider: modelName.substring(0, firstSlashIndex),
      model: modelName.substring(firstSlashIndex + 1),
    };
  }

  const provider = modelToProviderMap[modelName];
  if (!provider || provider === "aisdk") {
    return null;
  }

  return { provider, model: modelName };
}

export function getAISDKLanguageModel(
  subProvider: string,
  subModelName: string,
  clientOptions?: ClientOptions,
  middleware?: LanguageModelV3Middleware,
) {
  const hasValidOptions =
    clientOptions &&
    Object.values(clientOptions).some((v) => v !== undefined && v !== null);

  let model;
  if (hasValidOptions) {
    const creator = AISDKProvidersWithAPIKey[subProvider];
    if (!creator) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProvidersWithAPIKey),
      );
    }
    const provider = creator(clientOptions);
    model = provider(subModelName);
  } else {
    const provider = AISDKProviders[subProvider];
    if (!provider) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProviders),
      );
    }
    model = provider(subModelName);
  }

  if (middleware) {
    return wrapLanguageModel({ model, middleware });
  }
  return model;
}

export class LLMProvider {
  private logger: (message: LogLine) => void;
  private middleware?: LanguageModelV3Middleware;

  constructor(
    logger: (message: LogLine) => void,
    middleware?: LanguageModelV3Middleware,
  ) {
    this.logger = logger;
    this.middleware = middleware;
  }

  getClient(
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
    options?: {
      experimental?: boolean;
      disableAPI?: boolean;
      middleware?: LanguageModelV3Middleware;
    },
  ): LLMClient {
    const aisdkTarget = getAISDKProviderModel(modelName);
    if (aisdkTarget) {
      if (
        aisdkTarget.provider === "vertex" &&
        !options?.disableAPI &&
        !options?.experimental
      ) {
        throw new ExperimentalNotConfiguredError("Vertex provider");
      }

      const effectiveMiddleware = options?.middleware ?? this.middleware;
      const languageModel = getAISDKLanguageModel(
        aisdkTarget.provider,
        aisdkTarget.model,
        clientOptions,
        effectiveMiddleware,
      );

      if (!modelName.includes("/")) {
        this.logger({
          category: "llm",
          message: `Deprecation warning: Model format "${modelName}" is deprecated. Please use the provider/model format (e.g., "openai/gpt-5" or "anthropic/claude-sonnet-4").`,
          level: 0,
        });
      }

      return new AISdkClient({
        model: languageModel,
        logger: this.logger,
        clientOptions,
        providerName: aisdkTarget.provider,
      });
    }

    throw new UnsupportedModelError(Object.keys(modelToProviderMap));
  }

  static getModelProvider(modelName: AvailableModel): ModelProvider {
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
