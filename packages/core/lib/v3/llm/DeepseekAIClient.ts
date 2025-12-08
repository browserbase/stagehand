import OpenAI, { ClientOptions } from "openai";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat";
// import zodToJsonSchema from "zod-to-json-schema";
import { toJsonSchema } from "../zodCompat";
import { LogLine } from "../types/public/logs";
import { AvailableModel } from "../types/public/model";
import { validateZodSchema } from "../../utils";
import {
  ChatCompletionOptions,
  ChatMessage,
  CreateChatCompletionOptions,
  LLMClient,
  LLMResponse,
} from "./LLMClient";
import {
  CreateChatCompletionResponseError,
  ZodSchemaValidationError,
} from "../types/public/sdkErrors";

export class DeepseekAIClient extends LLMClient {
  public type = "deepseek" as const;
  private client: OpenAI;
  public clientOptions: ClientOptions;

  constructor({
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void;
    modelName: AvailableModel;
    clientOptions?: ClientOptions;
  }) {
    super(modelName);
    this.clientOptions = clientOptions;
    this.client = new OpenAI({
      ...clientOptions,
      baseURL: "https://api.deepseek.com/v1",
    });
    this.modelName = modelName;
  }

  async createChatCompletion<T = LLMResponse>({
    options,
    logger,
    retries = 3,
  }: CreateChatCompletionOptions): Promise<T> {
    const { requestId, ...optionsWithoutImageAndRequestId } = options;

    logger({
      category: "deepseek",
      message: "creating chat completion",
      level: 2,
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
      const screenshotMessage: ChatMessage = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${options.image.buffer.toString(
                "base64",
              )}`,
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages.push(screenshotMessage);
    }

    let responseFormat: { type: "json_object" } | undefined = undefined;
    if (options.response_model) {
      try {
        const parsedSchema = JSON.stringify(
          toJsonSchema(options.response_model.schema),
        );
        options.messages.push({
          role: "user",
          content: `Respond in this zod schema format:\n${parsedSchema}\n
          You must respond in JSON format. respond WITH JSON. Do not include any other text, formatting or markdown in your output. Do not include \`\`\` or \`\`\`json in your response. Only the JSON object itself.`,
        });
        responseFormat = { type: "json_object" };
      } catch (error) {
        logger({
          category: "deepseek",
          message: "Failed to parse response model schema",
          level: 0,
        });

        if (retries > 0) {
          return this.createChatCompletion({
            options: options as ChatCompletionOptions,
            logger,
            retries: retries - 1,
          });
        }

        throw error;
      }
    }

    /* eslint-disable */
    const { response_model, ...deepseekOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };
    /* eslint-enable */

    logger({
      category: "deepseek",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        deepseekOptions: {
          value: JSON.stringify(deepseekOptions),
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
              content: contentParts
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("\n"),
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
              content: contentParts
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("\n"),
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

    const modelNameToUse = this.modelName.startsWith("deepseek/")
      ? this.modelName.split("/")[1]
      : this.modelName;

    const body: ChatCompletionCreateParamsNonStreaming = {
      ...deepseekOptions,
      model: modelNameToUse,
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
      category: "deepseek",
      message: "response",
      level: 2,
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
      const extractedData = response.choices[0]?.message.content;

      if (extractedData === null) {
        const errorMessage = "Response content is null.";
        logger({
          category: "deepseek",
          message: errorMessage,
          level: 0,
        });
        if (retries > 0) {
          return this.createChatCompletion({
            options: options as ChatCompletionOptions,
            logger,
            retries: retries - 1,
          });
        }
        throw new CreateChatCompletionResponseError(errorMessage);
      }

      const parsedData = JSON.parse(extractedData);

      try {
        validateZodSchema(options.response_model.schema, parsedData);
      } catch (e) {
        logger({
          category: "deepseek",
          message: "Response failed Zod schema validation",
          level: 0,
        });
        if (retries > 0) {
          return this.createChatCompletion({
            options: options as ChatCompletionOptions,
            logger,
            retries: retries - 1,
          });
        }

        if (e instanceof ZodSchemaValidationError) {
          logger({
            category: "deepseek",
            message: `Error during Deepseek chat completion: ${e.message}`,
            level: 0,
            auxiliary: {
              errorDetails: {
                value: `Message: ${e.message}${
                  e.stack ? "\nStack: " + e.stack : ""
                }`,
                type: "string",
              },
              requestId: { value: requestId, type: "string" },
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

    return response as T;
  }
}
