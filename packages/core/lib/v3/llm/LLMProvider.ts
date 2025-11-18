import {
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors";
import { LogLine } from "../types/public/logs";
import {
  AvailableModel,
  ClientOptions,
  KnownModel,
  ModelProvider,
  MODEL_PROVIDER_MAP,
} from "../types/public/model";
import { AISdkClient } from "./aisdk";
import { AnthropicClient } from "./AnthropicClient";
import { CerebrasClient } from "./CerebrasClient";
import { GoogleClient } from "./GoogleClient";
import { GroqClient } from "./GroqClient";
import { LLMClient } from "./LLMClient";
import { OpenAIClient } from "./OpenAIClient";
import { openai, createOpenAI } from "@ai-sdk/openai";
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
import { ollama } from "ollama-ai-provider-v2";
import { AISDKProvider, AISDKCustomProvider } from "../types/public/model";

const AISDKProviders: Record<string, AISDKProvider> = {
  openai,
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
};
const AISDKProvidersWithAPIKey: Record<string, AISDKCustomProvider> = {
  openai: createOpenAI,
  anthropic: createAnthropic,
  google: createGoogleGenerativeAI,
  xai: createXai,
  azure: createAzure,
  groq: createGroq,
  cerebras: createCerebras,
  togetherai: createTogetherAI,
  mistral: createMistral,
  deepseek: createDeepSeek,
  perplexity: createPerplexity,
};

export function getAISDKLanguageModel(
  subProvider: string,
  subModelName: string,
  apiKey?: string,
  baseURL?: string,
) {
  if (apiKey) {
    const creator = AISDKProvidersWithAPIKey[subProvider];
    if (!creator) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProvidersWithAPIKey),
      );
    }
    // Create the provider instance with the API key and baseURL if provided
    const providerConfig: { apiKey: string; baseURL?: string } = { apiKey };
    if (baseURL) {
      providerConfig.baseURL = baseURL;
    }
    const provider = creator(providerConfig);
    // Get the specific model from the provider
    return provider(subModelName);
  } else {
    const provider = AISDKProviders[subProvider];
    if (!provider) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProviders),
      );
    }
    return provider(subModelName);
  }
}

export class LLMProvider {
  private logger: (message: LogLine) => void;

  constructor(logger: (message: LogLine) => void) {
    this.logger = logger;
  }

  getClient(
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
  ): LLMClient {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      const subModelName = modelName.substring(firstSlashIndex + 1);

      const languageModel = getAISDKLanguageModel(
        subProvider,
        subModelName,
        clientOptions?.apiKey,
        clientOptions?.baseURL,
      );

      return new AISdkClient({
        model: languageModel,
        logger: this.logger,
      });
    }

    const provider = MODEL_PROVIDER_MAP[modelName as KnownModel];
    if (!provider) {
      throw new UnsupportedModelError(Object.keys(MODEL_PROVIDER_MAP));
    }
    const availableModel = modelName as KnownModel;
    switch (provider) {
      case "openai":
        return new OpenAIClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "anthropic":
        return new AnthropicClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "cerebras":
        return new CerebrasClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "groq":
        return new GroqClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "google":
        return new GoogleClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      default:
        throw new UnsupportedModelProviderError([
          ...new Set(Object.values(MODEL_PROVIDER_MAP)),
        ]);
    }
  }

  static getModelProvider(modelName: AvailableModel): ModelProvider {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      if (AISDKProviders[subProvider]) {
        return "aisdk";
      }
    }
    const provider =
      MODEL_PROVIDER_MAP[modelName as keyof typeof MODEL_PROVIDER_MAP];
    return provider;
  }
}
