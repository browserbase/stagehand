import type { LanguageModelMiddleware } from "ai";
import type {
  ClientOptions,
  ModelName,
  ModelProvider,
} from "@browserbasehq/stagehand-protocol/types";
import { ClientOptionsSchema, ModelNameSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { AISdkClient } from "./aisdk.js";
import { LLMClient } from "./LLMClient.js";
import { wrapLanguageModel } from "ai";
import { createProviderLanguageModel } from "./providerRegistry.js";

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
  const model = createProviderLanguageModel(subProvider, subModelName, aiSdkClientOptions);

  if (middleware) {
    return wrapLanguageModel({ model, middleware });
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
