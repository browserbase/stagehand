import OpenAI, { ClientOptions as OpenAISDKClientOptions } from "openai";
import { z } from "zod/v4";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat";
import { LogLine } from "../types/public/logs.js";
import { ApiKeyClientOptions, AvailableModel } from "../types/public/model.js";
import { validateZodSchema } from "../utils.js";
import { CreateChatCompletionOptions, LLMClient, LLMResponse } from "./LLMClient.js";
import { ChatCompletionOptionsSchema } from "./schemas.js";
import {
  CreateChatCompletionResponseError,
  ZodSchemaValidationError,
} from "../types/public/sdkErrors.js";

export class OpenAIClient extends LLMClient {
  public type = "openai" as const;
  private client: OpenAI;
  declare public clientOptions: ApiKeyClientOptions;

  constructor({
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void;
    modelName: AvailableModel;
    clientOptions: ApiKeyClientOptions;
  }) {
    super(modelName);
    this.clientOptions = clientOptions;
    const { auth, baseURL, headers, organization } = clientOptions;
    this.client = new OpenAI({
      ...(baseURL ? { baseURL } : {}),
      ...(organization ? { organization } : {}),
      apiKey: auth.apiKey,
      ...(headers ? { defaultHeaders: headers } : {}),
    } satisfies OpenAISDKClientOptions);
    this.modelName = modelName;
  }

  async createChatCompletion<T = LLMResponse>({
    options: optionsInitial,
    logger,
    retries = 3,
  }: CreateChatCompletionOptions): Promise<T> {
    const options = ChatCompletionOptionsSchema.parse(optionsInitial);
    const { llmRequestId, image, ...optionsWithoutImageAndRequestId } = options;
    void image;

    logger({
      category: "openai",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify({
            ...optionsWithoutImageAndRequestId,
            llmRequestId,
          }),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    let responseFormat: ChatCompletionCreateParamsNonStreaming["response_format"] | undefined;
    if (options.response_model) {
      responseFormat = {
        type: "json_schema",
        json_schema: {
          name: options.response_model.name,
          schema: z.toJSONSchema(options.response_model.schema),
          strict: true,
        },
      };
    }

    /* eslint-disable */
    // Remove unsupported options
    const { response_model, ...openAiOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };
    /* eslint-enable */

    logger({
      category: "openai",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        openAiOptions: {
          value: JSON.stringify(openAiOptions),
          type: "object",
        },
      },
    });

    const formattedMessages: ChatCompletionMessageParam[] = options.messages.map((message) => {
      if (Array.isArray(message.content)) {
        const contentParts = message.content.map((content) => {
          if (content.type === "image_url" || content.type === "image") {
            const imageContent: ChatCompletionContentPartImage = {
              image_url: {
                url:
                  content.type === "image_url"
                    ? content.image_url.url
                    : `data:${content.source.media_type};base64,${content.source.data}`,
              },
              type: "image_url",
            };
            return imageContent;
          }

          const textContent: ChatCompletionContentPartText = {
            text: content.text,
            type: "text",
          };
          return textContent;
        });

        if (message.role === "system") {
          const formattedMessage: ChatCompletionSystemMessageParam = {
            ...message,
            role: "system",
            content: contentParts.filter(
              (content): content is ChatCompletionContentPartText => content.type === "text",
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
              (content): content is ChatCompletionContentPartText => content.type === "text",
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
      ...openAiOptions,
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

    logger({
      category: "openai",
      message: "response",
      level: 2,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        llmRequestId: {
          value: llmRequestId,
          type: "string",
        },
      },
    });

    if (options.response_model) {
      const extractedData = response.choices[0].message.content;
      if (!extractedData) {
        throw new CreateChatCompletionResponseError("OpenAI response did not include content");
      }
      const parsedData = JSON.parse(extractedData);

      try {
        validateZodSchema(options.response_model.schema, parsedData);
      } catch (e) {
        logger({
          category: "openai",
          message: "Response failed Zod schema validation",
          level: 0,
        });
        if (retries > 0) {
          return this.createChatCompletion({
            options,
            logger,
            retries: retries - 1,
          });
        }

        if (e instanceof ZodSchemaValidationError) {
          logger({
            category: "openai",
            message: `Error during OpenAI chat completion: ${e.message}`,
            level: 0,
            auxiliary: {
              errorDetails: {
                value: `Message: ${e.message}${e.stack ? "\nStack: " + e.stack : ""}`,
                type: "string",
              },
              llmRequestId: { value: llmRequestId, type: "string" },
            },
          });
          throw new CreateChatCompletionResponseError(e.message);
        }
        throw e;
      }

      return {
        data: parsedData,
        usage: response.usage,
      } as T;
    }

    // if the function was called with a response model, it would have returned earlier
    // so we can safely cast here to T, which defaults to ChatCompletion
    return response as T;
  }
}
