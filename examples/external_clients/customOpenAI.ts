/**
 * Welcome to the Stagehand custom OpenAI client!
 *
 * This is a client for models that are compatible with the OpenAI API, like Ollama, Gemini, etc.
 * You can just pass in an OpenAI instance to the client and it will work.
 */

import {
  AvailableModel,
  CreateChatCompletionOptions,
  LLMClient,
} from "@browserbasehq/stagehand";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import { z } from "zod/v3";
import { CreateChatCompletionResponseError } from "@/types/stagehandErrors";

function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export class CustomOpenAIClient extends LLMClient {
  public type = "openai" as const;
  private client: OpenAI;

  constructor({ modelName, client }: { modelName: string; client: OpenAI }) {
    super(modelName as AvailableModel);
    this.client = client;
    this.modelName = modelName as AvailableModel;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
    retries = 3,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const { image, requestId, ...optionsWithoutImageAndRequestId } = options;

    // TODO: Implement vision support
    if (image) {
      console.warn(
        "Image provided. Vision is not currently supported for openai",
      );
    }

    logger({
      category: "openai",
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

    if (options.image) {
      console.warn(
        "Image provided. Vision is not currently supported for openai",
      );
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
    const { response_model, ...openaiOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };

    logger({
      category: "openai",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        openaiOptions: {
          value: JSON.stringify(openaiOptions),
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
      ...openaiOptions,
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
      if (!extractedData) {
        throw new CreateChatCompletionResponseError("No content in response");
      }
      const parsedData = JSON.parse(extractedData);

      if (!validateZodSchema(options.response_model.schema, parsedData)) {
        if (retries > 0) {
          return this.createChatCompletion({
            options,
            logger,
            retries: retries - 1,
          });
        }

        throw new CreateChatCompletionResponseError("Invalid response schema");
      }

      return {
        data: parsedData,
        usage: {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: response.usage?.total_tokens ?? 0,
        },
      } as T;
    }

    return {
      data: response.choices[0].message.content,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
    } as T;
  }
}
