/**
 * Custom client for Z.ai (Zhipu AI) models like GLM-4.7.
 *
 * Z.ai's API is OpenAI-compatible but uses a proprietary `thinking` parameter
 * to control reasoning. This client extends the CustomOpenAIClient pattern to
 * support disabling (or enabling) thinking via the OpenAI SDK's extra body API.
 *
 * Usage:
 *   import { ZhipuOpenAIClient } from '@browserbasehq/stagehand';
 *   import OpenAI from 'openai';
 *
 *   const stagehand = new Stagehand({
 *     env: 'LOCAL',
 *     llmClient: new ZhipuOpenAIClient({
 *       modelName: 'glm-4.7',
 *       client: new OpenAI({
 *         apiKey: process.env.ZHIPU_API_KEY,
 *         baseURL: 'https://api.z.ai/api/coding/paas/v4',
 *       }),
 *     }),
 *   });
 */

import type { AvailableModel } from "../../lib/v3/types/public/model";
import {
  CreateChatCompletionOptions,
  LLMClient,
} from "../../lib/v3/llm/LLMClient";
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
import { toJsonSchema } from "../../lib/v3/zodCompat";
import { validateZodSchema } from "../../lib/utils";
import {
  CreateChatCompletionResponseError,
  ZodSchemaValidationError,
} from "../../lib/v3/types/public/sdkErrors";

export class ZhipuOpenAIClient extends LLMClient {
  public type = "openai" as const;
  private client: OpenAI;
  private enableThinking: boolean;

  constructor({
    modelName,
    client,
    enableThinking = false,
  }: {
    modelName: string;
    client: OpenAI;
    enableThinking?: boolean;
  }) {
    super(modelName as AvailableModel);
    this.client = client;
    this.modelName = modelName as AvailableModel;
    this.enableThinking = enableThinking;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
    retries = 3,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const { image, requestId, ...optionsWithoutImageAndRequestId } = options;

    if (image) {
      console.warn(
        "Image provided. Vision is not currently supported for openai",
      );
    }

    logger({
      category: "zhipu",
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
          inputSchema: tool.parameters,
        },
        type: "function",
      })),
    };

    const response = await this.client.chat.completions.create(body, {
      body: {
        thinking: {
          type: this.enableThinking ? "enabled" : "disabled",
        },
      },
    });

    logger({
      category: "zhipu",
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
          category: "zhipu",
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
            category: "zhipu",
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
