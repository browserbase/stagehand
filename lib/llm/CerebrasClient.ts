import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { OpenAIClient } from "./OpenAIClient";
import { LLMClient, CreateChatCompletionOptions, LLMResponse } from "./LLMClient";

export class CerebrasClient extends LLMClient {
  public type = "cerebras" as const;
  public hasVision = false;
  private openaiClient: OpenAIClient;

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
    clientOptions?: any;
    userProvidedInstructions?: string;
  }) {
    super(modelName, userProvidedInstructions);
    
    // Transform model name to remove cerebras- prefix
    const openaiModelName = modelName.startsWith("cerebras-") 
      ? modelName.split("cerebras-")[1] 
      : modelName;

    this.openaiClient = new OpenAIClient({
      enableCaching,
      cache,
      modelName: openaiModelName as AvailableModel,
      clientOptions: {
        baseURL: "https://api.cerebras.ai/v1",
        defaultHeaders: {
          apikey: clientOptions?.apiKey || process.env.CEREBRAS_API_KEY,
        },
        ...clientOptions,
      },
      logger: (message: LogLine) => {
        // Transform log messages to use cerebras category
        const transformedMessage = {
          ...message,
          category: message.category === "openai" ? "cerebras" : message.category,
        };
        // Call the original logger if it exists
        if (typeof (this as any).logger === 'function') {
          (this as any).logger(transformedMessage);
        }
      },
    });
  }

  async createChatCompletion<T = LLMResponse>(options: CreateChatCompletionOptions): Promise<T> {
    return this.openaiClient.createChatCompletion<T>(options);
  }

}
