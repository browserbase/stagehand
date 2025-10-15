import { LogLine } from "../../types/log";
import { AvailableModel, ClientOptions } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { AISdkClient } from "./aisdk";
import { LLMClient, CreateChatCompletionOptions, LLMResponse } from "./LLMClient";
import { createCerebras } from "@ai-sdk/cerebras";
import { LanguageModel } from "ai";

export class CerebrasClient extends LLMClient {
  public type = "cerebras" as const;
  public hasVision = false;
  private aisdkClient: AISdkClient;

  constructor({
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
    clientOptions?: ClientOptions;
    userProvidedInstructions?: string;
  }) {
    super(modelName, userProvidedInstructions);

    // Transform model name to remove cerebras- prefix
    const cerebrasModelName = modelName.startsWith("cerebras-")
      ? modelName.split("cerebras-")[1]
      : modelName;

    // Create Cerebras provider with API key
    const cerebrasProvider = createCerebras({
      apiKey: (clientOptions?.apiKey as string) || process.env.CEREBRAS_API_KEY,
    });

    // Get the specific model from the provider
    const cerebrasModel = cerebrasProvider(cerebrasModelName);

    this.aisdkClient = new AISdkClient({
      model: cerebrasModel as unknown as LanguageModel,
      logger: (message: LogLine) => {
        // Transform log messages to use cerebras category
        const transformedMessage = {
          ...message,
          category:
            message.category === "aisdk" ? "cerebras" : message.category,
        };
        // Call the original logger if it exists
        if (
          typeof (this as unknown as { logger?: (message: LogLine) => void })
            .logger === "function"
        ) {
          (this as unknown as { logger: (message: LogLine) => void }).logger(
            transformedMessage,
          );
        }
      },
      enableCaching,
      cache,
    });
  }

  async createChatCompletion<T = LLMResponse>(
    options: CreateChatCompletionOptions,
  ): Promise<T> {
    return this.aisdkClient.createChatCompletion<T>(options);
  }
}
