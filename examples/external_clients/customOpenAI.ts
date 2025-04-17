/**
 * Welcome to the Stagehand custom OpenAI client!
 *
 * This is a client for models that are compatible with the OpenAI API, like Ollama, Gemini, etc.
 * You can just pass in an OpenAI instance to the client and it will work.
 */

import { AvailableModel, CreateChatCompletionOptions, LLMClient } from "@/dist";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import { z } from "zod";
import { CreateChatCompletionResponseError } from "@/types/stagehandErrors";
import {
  GenerateObjectOptions,
  GenerateTextOptions,
  LLMObjectResponse,
  LLMResponse,
  ObjectResponse,
  StreamingChatResponse,
  StreamingTextResponse,
  TextResponse,
} from "@/lib";

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
        response: response,
      } as T;
    }

    return response as T;
  }

  async createChatCompletionStream<T = StreamingChatResponse>({
    options,
    logger,
    retries = 3,
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
      message: "creating chat completion stream",
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

    const body: ChatCompletionCreateParamsStreaming = {
      ...openaiOptions,
      model: this.modelName,
      messages: formattedMessages,
      response_format: responseFormat,
      stream: true,
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
    return response as T;
  }

  async streamText<T = StreamingTextResponse>({
    prompt,
    options = {},
  }: GenerateTextOptions): Promise<T> {
    // Destructure options with defaults
    const { logger = () => {}, retries = 3, ...chatOptions } = options;

    // Create a unique request ID if not provided
    const requestId = options.requestId || Date.now().toString();

    logger({
      category: "openai",
      message: "Initiating text streaming",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify({
            prompt,
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

    try {
      // Create a chat completion with the prompt as a user message
      const response = (await this.createChatCompletionStream({
        options: {
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          ...chatOptions,
          requestId,
        },
        logger,
        retries,
      })) as StreamingChatResponse;

      // Restructure the response to return a stream of text
      const textStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of response) {
              const content = chunk.choices[0]?.delta?.content;
              if (content !== undefined) {
                controller.enqueue(content);
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      logger({
        category: "openai",
        message: "text streaming response",
        level: 2,
        auxiliary: {
          response: {
            value: JSON.stringify(textStream),
            type: "object",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      return { textStream: textStream } as T;
    } catch (error) {
      logger({
        category: "openai",
        message: "Text streaming failed",
        level: 0,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
          prompt: {
            value: prompt,
            type: "string",
          },
        },
      });

      // Re-throw the error to be handled by the caller
      throw error;
    }
  }

  async generateText<T = TextResponse>({
    prompt,
    options = {},
  }: GenerateTextOptions): Promise<T> {
    // Destructure options with defaults
    const { logger = () => {}, retries = 3, ...chatOptions } = options;

    // Create chat completion with single user message
    const res = await (this.createChatCompletion({
      options: {
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        ...chatOptions,
        // Generate unique request ID if not provided
        requestId: options.requestId || Date.now().toString(),
      },
      logger,
      retries,
    }) as Promise<LLMResponse>);
    // Validate response and extract generated text
    if (res.choices && res.choices.length > 0) {
      return {
        text: res.choices[0].message.content,
        finishReason: res.choices[0].finish_reason,
        usage: res.usage,
        response: res,
      } as T;
    } else {
      throw new CreateChatCompletionResponseError("No choices in response");
    }
  }
  async generateObject<T = ObjectResponse>({
    prompt,
    schema,
    options = {},
  }: GenerateObjectOptions): Promise<T> {
    // Destructure options with defaults
    const {
      logger = () => {},
      retries = 3,
      requestId = Date.now().toString(),
      ...chatOptions
    } = options;

    try {
      // Log the generation attempt
      logger({
        category: "openai",
        message: "Initiating object generation",
        level: 2,
        auxiliary: {
          prompt: {
            value: prompt,
            type: "string",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      // Create chat completion with the provided prompt
      const response = (await this.createChatCompletion({
        options: {
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          response_model: {
            name: "object",
            schema: schema,
          },
          ...chatOptions,
          requestId,
        },
        logger,
        retries,
      })) as LLMObjectResponse;

      // Validate response structure
      if (!response.data || response.data.length === 0) {
        throw new CreateChatCompletionResponseError(
          "API response contains no valid choices",
        );
      }

      // Extract and validate the generated text
      const generatedObject = response.data;
      if (generatedObject === null || generatedObject === undefined) {
        throw new CreateChatCompletionResponseError(
          "Generated text content is empty",
        );
      }

      // Construct the final response
      const objResponse = {
        object: generatedObject,
        finishReason: response.response.choices[0].finish_reason,
        usage: response.response.usage,
        ...response,
      } as T;

      // Log successful generation
      logger({
        category: "openai",
        message: "Text generation successful",
        level: 2,
        auxiliary: {
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      return objResponse;
    } catch (error) {
      // Log the error
      logger({
        category: "openai",
        message: "Object generation failed",
        level: 0,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
          prompt: {
            value: prompt,
            type: "string",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      // Re-throw the error to be handled by the caller
      throw error;
    }
  }
}
