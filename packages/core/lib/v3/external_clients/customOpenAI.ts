/**
 * Welcome to the Stagehand custom OpenAI client!
 *
 * This is a client for models that are compatible with the OpenAI API, like Ollama, Gemini, etc.
 * You can just pass in an OpenAI instance to the client and it will work.
 */

import type { AvailableModel } from "../types/public/model.js";
import { CreateChatCompletionOptions, LLMClient } from "../llm/LLMClient.js";
import OpenAI from "openai";
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
import { toJsonSchema } from "../zodCompat.js";
import { validateZodSchema } from "../../utils.js";
import {
  CreateChatCompletionResponseError,
  ZodSchemaValidationError,
} from "../types/public/sdkErrors.js";

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

    let responseFormat:
      | ChatCompletionCreateParamsNonStreaming["response_format"]
      | undefined;
    if (options.response_model) {
      responseFormat = {
        type: "json_object",
      };
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

        return {
          ...message,
          content: message.content,
        } as ChatCompletionMessageParam;
      });

    if (options.response_model) {
      const schemaJson = JSON.stringify(
        toJsonSchema(options.response_model.schema),
        null,
        2,
      );
      formattedMessages.push({
        role: "user",
        content: `Respond with valid JSON matching this schema:\n${schemaJson}\n\nDo not include any other text, formatting or markdown in your output. Do not include \`\`\` or \`\`\`json in your response. Only the JSON object itself.`,
      });
    }

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

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(extractedData);
        validateZodSchema(options.response_model.schema, parsedData);
      } catch (e) {
        const isParseError = e instanceof SyntaxError;
        logger({
          category: "openai",
          message: isParseError
            ? "Response is not valid JSON"
            : "Response failed Zod schema validation",
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
            message: `Error during chat completion: ${e.message}`,
            level: 0,
            auxiliary: {
              errorDetails: {
                value: `Message: ${e.message}${e.stack ? "\nStack: " + e.stack : ""}`,
                type: "string",
              },
              requestId: { value: requestId, type: "string" },
            },
          });
          throw new CreateChatCompletionResponseError(e.message);
        }
        throw new CreateChatCompletionResponseError(
          isParseError
            ? "Failed to parse model response as JSON"
            : e instanceof Error
              ? e.message
              : "Unknown error during response processing",
        );
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
