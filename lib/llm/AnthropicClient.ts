import Anthropic, { ClientOptions } from "@anthropic-ai/sdk";
import {
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AnthropicJsonSchemaObject, AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import {
  CreateChatCompletionOptions,
  GenerateObjectOptions,
  GenerateTextOptions,
  LLMClient,
  LLMObjectResponse,
  LLMResponse,
  ObjectResponse,
  StreamingChatResponse,
  StreamingTextResponse,
  TextResponse,
} from "./LLMClient";
import { CreateChatCompletionResponseError } from "@/types/stagehandErrors";

export class AnthropicClient extends LLMClient {
  public type = "anthropic" as const;
  private client: Anthropic;
  private cache: LLMCache | undefined;
  private enableCaching: boolean;
  public clientOptions: ClientOptions;

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
    super(modelName);
    this.client = new Anthropic(clientOptions);
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
    this.clientOptions = clientOptions;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  async createChatCompletion<T = LLMResponse>({
    options,
    retries,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const optionsWithoutImage = { ...options };
    delete optionsWithoutImage.image;

    logger({
      category: "anthropic",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify(optionsWithoutImage),
          type: "object",
        },
      },
    });

    // Try to get cached response
    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      image: options.image,
      response_model: options.response_model,
      tools: options.tools,
      retries: retries,
    };

    if (this.enableCaching) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        options.requestId,
      );
      if (cachedResponse) {
        logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
              type: "object",
            },
          },
        });
        return cachedResponse as T;
      } else {
        logger({
          category: "llm_cache",
          message: "LLM cache miss - no cached response found",
          level: 1,
          auxiliary: {
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
      }
    }

    const systemMessage = options.messages.find((msg) => {
      if (msg.role === "system") {
        if (typeof msg.content === "string") {
          return true;
        } else if (Array.isArray(msg.content)) {
          return msg.content.every((content) => content.type !== "image_url");
        }
      }
      return false;
    });

    const userMessages = options.messages.filter(
      (msg) => msg.role !== "system",
    );

    const formattedMessages: MessageParam[] = userMessages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role as "user" | "assistant", // ensure its not checking for system types
          content: msg.content,
        };
      } else {
        return {
          role: msg.role as "user" | "assistant",
          content: msg.content.map((content) => {
            if ("image_url" in content) {
              const formattedContent: ImageBlockParam = {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: content.image_url.url,
                },
              };

              return formattedContent;
            } else {
              return { type: "text", text: content.text };
            }
          }),
        };
      }
    });

    if (options.image) {
      const screenshotMessage: MessageParam = {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: options.image.buffer.toString("base64"),
            },
          },
        ],
      };
      if (
        options.image.description &&
        Array.isArray(screenshotMessage.content)
      ) {
        screenshotMessage.content.push({
          type: "text",
          text: options.image.description,
        });
      }

      formattedMessages.push(screenshotMessage);
    }

    let anthropicTools: Tool[] = options.tools?.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object",
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      };
    });

    let toolDefinition: Tool | undefined;
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema);
      const { properties: schemaProperties, required: schemaRequired } =
        extractSchemaProperties(jsonSchema);

      toolDefinition = {
        name: "print_extracted_data",
        description: "Prints the extracted data based on the provided schema.",
        input_schema: {
          type: "object",
          properties: schemaProperties,
          required: schemaRequired,
        },
      };
    }

    if (toolDefinition) {
      anthropicTools = anthropicTools ?? [];
      anthropicTools.push(toolDefinition);
    }

    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options.maxTokens || 8192,
      messages: formattedMessages,
      tools: anthropicTools,
      system: systemMessage
        ? (systemMessage.content as string | TextBlockParam[]) // we can cast because we already filtered out image content
        : undefined,
      temperature: options.temperature,
    });

    logger({
      category: "anthropic",
      message: "response",
      level: 2,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        requestId: {
          value: options.requestId,
          type: "string",
        },
      },
    });

    // We'll compute usage data from the response
    const usageData = {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    const transformedResponse: LLMResponse = {
      id: response.id,
      object: "chat.completion",
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              response.content.find((c) => c.type === "text")?.text || null,
            tool_calls: response.content
              .filter((c) => c.type === "tool_use")
              .map((toolUse) => ({
                id: toolUse.id,
                type: "function",
                function: {
                  name: toolUse.name,
                  arguments: JSON.stringify(toolUse.input),
                },
              })),
          },
          finish_reason: response.stop_reason,
        },
      ],
      usage: usageData,
    };

    logger({
      category: "anthropic",
      message: "transformed response",
      level: 2,
      auxiliary: {
        transformedResponse: {
          value: JSON.stringify(transformedResponse),
          type: "object",
        },
        requestId: {
          value: options.requestId,
          type: "string",
        },
      },
    });

    if (options.response_model) {
      const toolUse = response.content.find((c) => c.type === "tool_use");
      if (toolUse && "input" in toolUse) {
        const result = toolUse.input;

        const finalParsedResponse = {
          data: result,
          usage: usageData,
        } as unknown as T;

        if (this.enableCaching) {
          this.cache.set(cacheOptions, finalParsedResponse, options.requestId);
        }

        return finalParsedResponse;
      } else {
        if (!retries || retries < 5) {
          return this.createChatCompletion({
            options,
            logger,
            retries: (retries ?? 0) + 1,
          });
        }
        logger({
          category: "anthropic",
          message: "error creating chat completion",
          level: 0,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
        throw new CreateChatCompletionResponseError(
          "No tool use with input in response",
        );
      }
    }

    if (this.enableCaching) {
      this.cache.set(cacheOptions, transformedResponse, options.requestId);
      logger({
        category: "anthropic",
        message: "cached response",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
          transformedResponse: {
            value: JSON.stringify(transformedResponse),
            type: "object",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
        },
      });
    }

    // if the function was called with a response model, it would have returned earlier
    // so we can safely cast here to T, which defaults to AnthropicTransformedResponse
    return transformedResponse as T;
  }

  async createChatCompletionStream<T = StreamingChatResponse>({
    options,
    retries,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    console.log(options, logger, retries);
    const optionsWithoutImage = { ...options };
    delete optionsWithoutImage.image;

    logger({
      category: "anthropic",
      message: "creating chat completion stream",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify(optionsWithoutImage),
          type: "object",
        },
      },
    });

    // Try to get cached response
    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      image: options.image,
      response_model: options.response_model,
      tools: options.tools,
      retries: retries,
    };

    if (this.enableCaching) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        options.requestId,
      );
      if (cachedResponse) {
        logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
              type: "object",
            },
          },
        });
        return cachedResponse as T;
      } else {
        logger({
          category: "llm_cache",
          message: "LLM cache miss - no cached response found",
          level: 1,
          auxiliary: {
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
      }
    }

    const systemMessage = options.messages.find((msg) => {
      if (msg.role === "system") {
        if (typeof msg.content === "string") {
          return true;
        } else if (Array.isArray(msg.content)) {
          return msg.content.every((content) => content.type !== "image_url");
        }
      }
      return false;
    });

    const userMessages = options.messages.filter(
      (msg) => msg.role !== "system",
    );

    const formattedMessages: MessageParam[] = userMessages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role as "user" | "assistant", // ensure its not checking for system types
          content: msg.content,
        };
      } else {
        return {
          role: msg.role as "user" | "assistant",
          content: msg.content.map((content) => {
            if ("image_url" in content) {
              const formattedContent: ImageBlockParam = {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: content.image_url.url,
                },
              };

              return formattedContent;
            } else {
              return { type: "text", text: content.text };
            }
          }),
        };
      }
    });

    if (options.image) {
      const screenshotMessage: MessageParam = {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: options.image.buffer.toString("base64"),
            },
          },
        ],
      };
      if (
        options.image.description &&
        Array.isArray(screenshotMessage.content)
      ) {
        screenshotMessage.content.push({
          type: "text",
          text: options.image.description,
        });
      }

      formattedMessages.push(screenshotMessage);
    }

    let anthropicTools: Tool[] = options.tools?.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object",
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      };
    });

    let toolDefinition: Tool | undefined;

    // Check if a response model is provided
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema);
      const { properties: schemaProperties, required: schemaRequired } =
        extractSchemaProperties(jsonSchema);

      toolDefinition = {
        name: "print_extracted_data",
        description: "Prints the extracted data based on the provided schema.",
        input_schema: {
          type: "object",
          properties: schemaProperties,
          required: schemaRequired,
        },
      };
    }

    // Add the tool definition to the tools array if it exists
    if (toolDefinition) {
      anthropicTools = anthropicTools ?? [];
      anthropicTools.push(toolDefinition);
    }

    // Create the chat completion stream with the provided messages
    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options.maxTokens || 8192,
      messages: formattedMessages,
      tools: anthropicTools,
      system: systemMessage
        ? (systemMessage.content as string | TextBlockParam[])
        : undefined,
      temperature: options.temperature,
      stream: true,
    });

    // Restructure the response to match the expected format
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              controller.enqueue(chunk.delta.text);
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    }) as T;
  }

  async streamText<T = StreamingTextResponse>({
    prompt,
    options = {},
  }: GenerateTextOptions): Promise<T> {
    // Destructure options with defaults
    const { logger = () => {}, retries = 3, ...chatOptions } = options;

    // Create a unique request ID if not provided
    const requestId = options.requestId || Date.now().toString();

    // Log the generation attempt
    logger({
      category: "anthropic",
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
      // Create a chat completion stream with the prompt as a user message
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

      logger({
        category: "anthropic",
        message: "text streaming response",
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

      return {
        textStream: response,
      } as T;
    } catch (error) {
      logger({
        category: "anthropic",
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
    const {
      logger = () => {},
      retries = 3,
      requestId = Date.now().toString(),
      ...chatOptions
    } = options;

    try {
      // Log the generation attempt
      logger({
        category: "anthropic",
        message: "Initiating text generation",
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
          ...chatOptions,
          requestId,
        },
        logger,
        retries,
      })) as LLMResponse;

      // Validate response structure
      if (!response.choices || response.choices.length === 0) {
        throw new CreateChatCompletionResponseError(
          "API response contains no valid choices",
        );
      }

      // Extract and validate the generated text
      const generatedText = response.choices[0].message.content;
      if (generatedText === null || generatedText === undefined) {
        throw new CreateChatCompletionResponseError(
          "Generated text content is empty",
        );
      }

      // Construct the final response
      const textResponse = {
        ...response,
        text: generatedText,
      } as T;

      // Log successful generation
      logger({
        category: "anthropic",
        message: "Text generation successful",
        level: 2,
        auxiliary: {
          requestId: {
            value: requestId,
            type: "string",
          },
          responseLength: {
            value: generatedText.length.toString(),
            type: "string",
          },
        },
      });

      return textResponse;
    } catch (error) {
      // Log the error
      logger({
        category: "anthropic",
        message: "Text generation failed",
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
        category: "anthropic",
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
        ...response,
        object: generatedObject,
      } as T;

      // Log successful generation
      logger({
        category: "anthropic",
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
        category: "anthropic",
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

const extractSchemaProperties = (jsonSchema: AnthropicJsonSchemaObject) => {
  const schemaRoot = jsonSchema.definitions?.MySchema || jsonSchema;

  return {
    properties: schemaRoot.properties,
    required: schemaRoot.required,
  };
};
