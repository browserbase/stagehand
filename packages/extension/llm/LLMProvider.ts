import type { LanguageModel, LanguageModelMiddleware } from "ai";
import type { ClientOptions, ModelName, ModelProvider } from "../../protocol/types.js";
import { ClientOptionsSchema, ModelNameSchema } from "../../protocol/pending-schemas.js";
import { AISdkClient } from "./aisdk.js";
import { LLMClient } from "./LLMClient.js";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import { wrapLanguageModel } from "ai";

// Compile-only bridge: current AI SDK providers return mixed v2/v3/v4 model
// types, while copied V3 code assumed a single provider model type.
type AISDKProvider = (modelName: string) => LanguageModel;
type AISDKProviderFactory = (options: Record<string, unknown>) => AISDKProvider;

const AISDKProviderFactories: Record<ModelProvider, AISDKProviderFactory> = {
  openai: createOpenAI as AISDKProviderFactory,
  anthropic: createAnthropic as AISDKProviderFactory,
  google: createGoogleGenerativeAI as AISDKProviderFactory,
  groq: createGroq as AISDKProviderFactory,
  cerebras: createCerebras as AISDKProviderFactory,
};

type AISDKProviderClientOptions = ClientOptions & Record<string, unknown>;

function parseClientOptions(clientOptions?: ClientOptions): ClientOptions {
  return ClientOptionsSchema.parse(clientOptions);
}

export function toAISDKClientOptions(
  _subProvider: ModelProvider,
  clientOptions?: ClientOptions,
): AISDKProviderClientOptions | undefined {
  const { auth, providerOptions: _providerOptions, ...rest } = parseClientOptions(clientOptions);
  delete rest.provider;
  const apiKeyOption = auth?.type === "apiKey" ? { apiKey: auth.apiKey } : {};
  const options = {
    ...rest,
    ...apiKeyOption,
  };

  return Object.values(options).some((value) => value !== undefined && value !== null)
    ? options
    : undefined;
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
    throw new TypeError(
      `${subProvider} is not currently supported for aiSDK. Please use one of the supported model providers: ${Object.keys(AISDKProviderFactories).join(", ")}`,
    );
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
  middleware?: LanguageModelMiddleware;

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
