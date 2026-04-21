import type {
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Middleware,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import {
  ExperimentalNotConfiguredError,
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors.js";
import { LogLine } from "../types/public/logs.js";
import {
  AvailableModel,
  ClientOptions,
  ModelProvider,
} from "../types/public/model.js";
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
  ollama: createOllama,
  gateway: createGateway,
};

const OPUS_47_MODEL_PATTERN = /^claude-opus-4-7(?:$|-)/;

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

function shouldOmitTemperatureForModel(
  subProvider: string,
  subModelName: string,
): boolean {
  return (
    subProvider === "anthropic" && OPUS_47_MODEL_PATTERN.test(subModelName)
  );
}

function createOpus47TemperatureWarning(
  modelId: string,
): LanguageModelV2CallWarning {
  return {
    type: "unsupported-setting",
    setting: "temperature",
    details: `temperature is not supported by anthropic/${modelId}. The setting was omitted.`,
  };
}

function createOpus47TemperatureMiddleware(
  modelId: string,
): LanguageModelV2Middleware {
  const warningByParams = new WeakMap<
    LanguageModelV2CallOptions,
    LanguageModelV2CallWarning[]
  >();

  const getWarningsForParams = (params: LanguageModelV2CallOptions) => {
    const warnings = warningByParams.get(params) ?? [];
    warningByParams.delete(params);
    return warnings;
  };

  return {
    middlewareVersion: "v2",
    transformParams: async ({ params }) => {
      if (params.temperature == null) {
        return params;
      }

      const transformedParams: LanguageModelV2CallOptions = {
        ...params,
        temperature: undefined,
      };
      warningByParams.set(transformedParams, [
        createOpus47TemperatureWarning(modelId),
      ]);
      return transformedParams;
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      const warnings = getWarningsForParams(params);

      if (warnings.length === 0) {
        return result;
      }

      return {
        ...result,
        warnings: [...(result.warnings ?? []), ...warnings],
      };
    },
    wrapStream: async ({ doStream, params }) => {
      const result = await doStream();
      const warnings = getWarningsForParams(params);

      if (warnings.length === 0) {
        return result;
      }

      let emittedStreamStart = false;
      const reader = result.stream.getReader();

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async pull(controller) {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          if (value.type === "stream-start") {
            emittedStreamStart = true;
            controller.enqueue({
              ...value,
              warnings: [...value.warnings, ...warnings],
            });
            return;
          }

          if (!emittedStreamStart) {
            emittedStreamStart = true;
            controller.enqueue({
              type: "stream-start",
              warnings,
            });
          }

          controller.enqueue(value);
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      });

      return {
        ...result,
        stream,
      };
    },
  };
}

export function getAISDKLanguageModel(
  subProvider: string,
  subModelName: string,
  clientOptions?: ClientOptions,
  middleware?: LanguageModelV2Middleware,
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
    model = wrapLanguageModel({ model, middleware });
  }

  if (shouldOmitTemperatureForModel(subProvider, subModelName)) {
    model = wrapLanguageModel({
      model,
      middleware: createOpus47TemperatureMiddleware(subModelName),
    });
  }

  return model;
}

export class LLMProvider {
  private logger: (message: LogLine) => void;
  private middleware?: LanguageModelV2Middleware;

  constructor(
    logger: (message: LogLine) => void,
    middleware?: LanguageModelV2Middleware,
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
      middleware?: LanguageModelV2Middleware;
    },
  ): LLMClient {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      const subModelName = modelName.substring(firstSlashIndex + 1);
      if (
        subProvider === "vertex" &&
        !options?.disableAPI &&
        !options?.experimental
      ) {
        throw new ExperimentalNotConfiguredError("Vertex provider");
      }

      const effectiveMiddleware = options?.middleware ?? this.middleware;
      const languageModel = getAISDKLanguageModel(
        subProvider,
        subModelName,
        clientOptions,
        effectiveMiddleware,
      );

      return new AISdkClient({
        model: languageModel,
        logger: this.logger,
        clientOptions,
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
        // This default case handles unknown providers that exist in modelToProviderMap
        // but aren't implemented in the switch. This is an internal consistency issue.
        throw new UnsupportedModelProviderError([
          ...new Set(Object.values(modelToProviderMap)),
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
    const provider = modelToProviderMap[modelName];
    return provider;
  }
}
