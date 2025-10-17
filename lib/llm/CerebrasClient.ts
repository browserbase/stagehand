import { createCerebras, CerebrasProviderSettings } from "@ai-sdk/cerebras";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { AISdkClient } from "./aisdk";
import { LLMClient, CreateChatCompletionOptions } from "./LLMClient";

export class CerebrasClient extends LLMClient {
  public type = "cerebras" as const;
  public hasVision = false;
  private client: AISdkClient;

  constructor({
    logger,
    enableCaching = false,
    cache,
    modelName,
    clientOptions,
    userProvidedInstructions,
  }: {
    logger: (message: LogLine) => void;
    enableCaching?: boolean;
    cache?: LLMCache;
    modelName: AvailableModel;
    clientOptions?: CerebrasProviderSettings;
    userProvidedInstructions?: string;
  }) {
    super(modelName, userProvidedInstructions);
    this.clientOptions = clientOptions || {};

    const actualModelName = modelName.replace("cerebras-", "");
    const cerebrasProvider = createCerebras({
      apiKey: clientOptions?.apiKey || process.env.CEREBRAS_API_KEY,
      baseURL: clientOptions?.baseURL,
    });
    const languageModel = cerebrasProvider(actualModelName);

    this.client = new AISdkClient({
      model: languageModel,
      logger: (message: LogLine) => {
        logger({
          ...message,
          category:
            message.category === "aisdk" ? "cerebras" : message.category,
        });
      },
      enableCaching,
      cache,
    });
  }

  async createChatCompletion<T>(
    options: CreateChatCompletionOptions,
  ): Promise<T> {
    return this.client.createChatCompletion<T>(options);
  }

  public getLanguageModel() {
    return this.client.getLanguageModel();
  }
}
