import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { UnsupportedAISDKModelProviderError } from "../errors.js";
import type { ClientOptions, ModelName, ModelProvider } from "../../protocol/types.js";
import {
  ClientOptionsSchema,
  ModelNameSchema,
  ResolvedProviderClientOptionsSchema,
} from "../../protocol/pending-schemas.js";
import { AISdkClient } from "./aisdk.js";
import { LLMClient } from "./LLMClient.js";
import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex/edge";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createAzure } from "@ai-sdk/azure";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createOllama } from "ollama-ai-provider-v2";
import { createGateway, wrapLanguageModel } from "ai";

// Compile-only bridge: current AI SDK providers return mixed v2/v3/v4 model
// types, while copied V3 code assumed a single provider model type.
type AISDKProvider = (modelName: string) => LanguageModel;
type AISDKProviderFactory = (options: Record<string, unknown>) => AISDKProvider;

const AISDKProviderFactories: Record<ModelProvider, AISDKProviderFactory> = {
  openai: createOpenAI as AISDKProviderFactory,
  bedrock: createAmazonBedrock as AISDKProviderFactory,
  anthropic: createAnthropic as AISDKProviderFactory,
  google: createGoogleGenerativeAI as AISDKProviderFactory,
  vertex: createVertex as AISDKProviderFactory,
  xai: createXai as AISDKProviderFactory,
  azure: createAzure as AISDKProviderFactory,
  groq: createGroq as AISDKProviderFactory,
  cerebras: createCerebras as AISDKProviderFactory,
  togetherai: createTogetherAI as AISDKProviderFactory,
  mistral: createMistral as AISDKProviderFactory,
  deepseek: createDeepSeek as AISDKProviderFactory,
  perplexity: createPerplexity as AISDKProviderFactory,
  ollama: createOllama as AISDKProviderFactory,
  gateway: createGateway as AISDKProviderFactory,
};

type AISDKProviderClientOptions = ClientOptions & Record<string, unknown>;

function parseClientOptions(clientOptions?: ClientOptions): ClientOptions {
  return ClientOptionsSchema.parse(clientOptions);
}

export function toAISDKClientOptions(
  subProvider: ModelProvider,
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
    ...apiKeyOption,
    ...vertexOptions,
    ...(auth?.type === "googleServiceAccount"
      ? {
          googleCredentials: {
            clientEmail: auth.credentials.clientEmail,
            privateKey: auth.credentials.privateKey,
            ...(auth.credentials.privateKeyId
              ? { privateKeyId: auth.credentials.privateKeyId }
              : {}),
          },
          ...(auth.projectId && !vertexOptions?.project ? { project: auth.projectId } : {}),
        }
      : {}),
  };
}

export function getAISDKLanguageModel(
  subProvider: ModelProvider,
  subModelName: string,
  clientOptions?: ClientOptions,
  middleware?: LanguageModelMiddleware,
) {
  const aiSdkClientOptions = toAISDKClientOptions(subProvider, clientOptions);
  const creator = AISDKProviderFactories[subProvider];
  if (!creator) {
    throw new UnsupportedAISDKModelProviderError(subProvider, Object.keys(AISDKProviderFactories));
  }
  const provider = creator(aiSdkClientOptions ?? {});
  const model =
    subProvider === "openai"
      ? (provider as ReturnType<typeof createOpenAI>).responses(subModelName)
      : provider(subModelName);

  if (middleware) {
    return wrapLanguageModel({ model: model as never, middleware });
  }
  return model;
}

export class LLMProvider {
  private middleware?: LanguageModelMiddleware;

  constructor(middleware?: LanguageModelMiddleware) {
    this.middleware = middleware;
  }

  getClient(
    modelName: ModelName,
    clientOptions?: ClientOptions,
    options?: {
      experimental?: boolean;
      disableAPI?: boolean;
      middleware?: LanguageModelMiddleware;
    },
  ): LLMClient {
    const parsedClientOptions = parseClientOptions(clientOptions);
    const parsedModelName = ModelNameSchema.parse(modelName);
    const firstSlashIndex = parsedModelName.indexOf("/");
    const subProvider = parsedModelName.substring(0, firstSlashIndex) as ModelProvider;
    const subModelName = parsedModelName.substring(firstSlashIndex + 1);

    const effectiveMiddleware = options?.middleware ?? this.middleware;
    const languageModel = getAISDKLanguageModel(
      subProvider,
      subModelName,
      parsedClientOptions,
      effectiveMiddleware,
    );
    return new AISdkClient({
      model: languageModel,
      modelName: parsedModelName,
      clientOptions: parsedClientOptions,
    });
  }
}
