import OpenAI, { type ClientOptions } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { LLMCache } from "../../lib/cache/LLMCache";
import { validateZodSchema } from "../../lib/utils";
import {
  type ChatCompletionOptions,
  type ChatMessage,
  LLMClient,
} from "../../lib/llm/LLMClient";
import type { LogLine } from "../../types/log";
import type { AvailableModel } from "../../types/model";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat";

export class OllamaClient extends LLMClient {
  public type = "ollama" as const;
  private client: OpenAI;
  private cache: LLMCache | undefined;
  public logger: (message: LogLine) => void;
  private enableCaching: boolean;
  public clientOptions: ClientOptions;

  constructor({
    logger,
    enableCaching = false,
    cache = undefined,
    modelName = "llama3.2",
    clientOptions,
  }: {
    logger?: (message: LogLine) => void;
    enableCaching?: boolean;
    cache?: LLMCache;
    modelName?: string;
    clientOptions?: ClientOptions;
  }) {
    super(modelName as AvailableModel);
    this.client = new OpenAI({
      ...clientOptions,
      baseURL: clientOptions?.baseURL || "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName as AvailableModel;
  }

  async createChatCompletion<T = ChatCompletion>(
    options: ChatCompletionOptions,
    retries = 3,
  ): Promise<T> {
    const { image, requestId, ...optionsWithoutImageAndRequestId } = options;

    // TODO: Implement vision support
    if (image) {
      throw new Error(
        "Image provided. Vision is not currently supported for Ollama",
      );
    }

    this.logger({
      category: "ollama",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify({
            ...optionsWithoutImageAndRequestId,
            requestId,
          }),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      image: image,
      response_model: options.response_model,
    };

    if (options.image) {
      const screenshotMessage: ChatMessage = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${options.image.buffer.toString("base64")}`,
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages.push(screenshotMessage);
    }

    if (this.enableCaching && this.cache) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        options.requestId,
      );

      if (cachedResponse) {
        this.logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
          },
        });
        return cachedResponse;
      }

      this.logger({
        category: "llm_cache",
        message: "LLM cache miss - no cached response found",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });
    }

    let responseFormat = undefined;
    if (options.response_model) {
      responseFormat = zodResponseFormat(
        options.response_model.schema,
        options.response_model.name,
      );
    }

    /* eslint-disable */
    // Remove unsupported options
    const { response_model, ...ollamaOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };

    this.logger({
      category: "ollama",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        ollamaOptions: {
          value: JSON.stringify(ollamaOptions),
          type: "object",
        },
      },
    });

    const formattedMessages: ChatCompletionMessageParam[] =
      options.messages.map((message) => {
        if (Array.isArray(message.content)) {
          const contentParts = message.content.map((content) => {
            if ("image_url" in content) {
              const imageContent: ChatCompletionContentPartImage = {
                image_url: {
                  url: content.image_url.url,
                },
                type: "image_url",
              };
              return imageContent;
            } else {
              const textContent: ChatCompletionContentPartText = {
                text: content.text,
                type: "text",
              };
              return textContent;
            }
          });

          if (message.role === "system") {
            const formattedMessage: ChatCompletionSystemMessageParam = {
              ...message,
              role: "system",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          } else if (message.role === "user") {
            const formattedMessage: ChatCompletionUserMessageParam = {
              ...message,
              role: "user",
              content: contentParts,
            };
            return formattedMessage;
          } else {
            const formattedMessage: ChatCompletionAssistantMessageParam = {
              ...message,
              role: "assistant",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          }
        }

        const formattedMessage: ChatCompletionUserMessageParam = {
          role: "user",
          content: message.content,
        };

        return formattedMessage;
      });

    const body: ChatCompletionCreateParamsNonStreaming = {
      ...ollamaOptions,
      model: this.modelName,
      messages: formattedMessages,
      response_format: responseFormat,
      stream: false,
      tools: options.tools?.map((tool) => ({
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
        type: "function",
      })),
    };

    const response = await this.client.chat.completions.create(body);

    this.logger({
      category: "ollama",
      message: "response",
      level: 1,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });

    if (options.response_model) {
      const extractedData = response.choices[0].message.content;
      const parsedData = JSON.parse(extractedData);

      if (!validateZodSchema(options.response_model.schema, parsedData)) {
        if (retries > 0) {
          return this.createChatCompletion(options, retries - 1);
        }

        throw new Error("Invalid response schema");
      }

      if (this.enableCaching) {
        this.cache.set(
          cacheOptions,
          {
            ...parsedData,
          },
          options.requestId,
        );
      }

      return parsedData;
    }

    if (this.enableCaching) {
      this.logger({
        category: "llm_cache",
        message: "caching response",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });
      this.cache.set(cacheOptions, response, options.requestId);
    }

    return response as T;
  }
}
