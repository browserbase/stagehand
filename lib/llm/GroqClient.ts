import type { ClientOptions } from "openai";
import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import {
  ChatMessage,
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

export class GroqClient extends LLMClient {
  public type = "groq" as const;
  private client: OpenAI;
  private cache: LLMCache | undefined;
  private enableCaching: boolean;
  public clientOptions: ClientOptions;
  public hasVision = false;

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

    // Create OpenAI client with the base URL set to Groq API
    this.client = new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: clientOptions?.apiKey || process.env.GROQ_API_KEY,
      ...clientOptions,
    });

    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
    this.clientOptions = clientOptions;
  }

  async createChatCompletion<T = LLMResponse>({
    options,
    retries,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const optionsWithoutImage = { ...options };
    delete optionsWithoutImage.image;

    logger({
      category: "groq",
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
      model: this.modelName.split("groq-")[1],
      messages: options.messages,
      temperature: options.temperature,
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
      }
    }

    // Format messages for Groq API (using OpenAI format)
    const formattedMessages = options.messages.map((msg: ChatMessage) => {
      const baseMessage = {
        content:
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content) &&
                msg.content.length > 0 &&
                "text" in msg.content[0]
              ? msg.content[0].text
              : "",
      };

      // Groq supports system, user, and assistant roles
      if (msg.role === "system") {
        return { ...baseMessage, role: "system" as const };
      } else if (msg.role === "assistant") {
        return { ...baseMessage, role: "assistant" as const };
      } else {
        // Default to user for any other role
        return { ...baseMessage, role: "user" as const };
      }
    });

    // Format tools if provided
    let tools = options.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));

    // Add response model as a tool if provided
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const schemaProperties = jsonSchema.properties || {};
      const schemaRequired = jsonSchema.required || [];

      const responseTool = {
        type: "function" as const,
        function: {
          name: "print_extracted_data",
          description:
            "Prints the extracted data based on the provided schema.",
          parameters: {
            type: "object",
            properties: schemaProperties,
            required: schemaRequired,
          },
        },
      };

      tools = tools ? [...tools, responseTool] : [responseTool];
    }

    try {
      // Use OpenAI client with Groq API
      const apiResponse = await this.client.chat.completions.create({
        model: this.modelName.split("groq-")[1],
        messages: [
          ...formattedMessages,
          // Add explicit instruction to return JSON if we have a response model
          ...(options.response_model
            ? [
                {
                  role: "system" as const,
                  content: `IMPORTANT: Your response must be valid JSON that matches this schema: ${JSON.stringify(options.response_model.schema)}`,
                },
              ]
            : []),
        ],
        temperature: options.temperature || 0.7,
        max_tokens: options.maxTokens,
        tools: tools,
        tool_choice: options.tool_choice || "auto",
      });

      // Format the response to match the expected LLMResponse format
      const response: LLMResponse = {
        id: apiResponse.id,
        object: "chat.completion",
        created: Date.now(),
        model: this.modelName.split("groq-")[1],
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: apiResponse.choices[0]?.message?.content || null,
              tool_calls: apiResponse.choices[0]?.message?.tool_calls || [],
            },
            finish_reason: apiResponse.choices[0]?.finish_reason || "stop",
          },
        ],
        usage: {
          prompt_tokens: apiResponse.usage?.prompt_tokens || 0,
          completion_tokens: apiResponse.usage?.completion_tokens || 0,
          total_tokens: apiResponse.usage?.total_tokens || 0,
        },
      };

      logger({
        category: "groq",
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

      if (options.response_model) {
        // First try standard function calling format
        const toolCall = response.choices[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          try {
            const result = JSON.parse(toolCall.function.arguments);
            if (this.enableCaching) {
              this.cache.set(cacheOptions, result, options.requestId);
            }
            return { data: result, response: response } as T;
          } catch (e) {
            // If JSON parse fails, the model might be returning a different format
            logger({
              category: "groq",
              message: "failed to parse tool call arguments as JSON, retrying",
              level: 0,
              auxiliary: {
                error: {
                  value: e.message,
                  type: "string",
                },
              },
            });
          }
        }

        // If we have content but no tool calls, try to parse the content as JSON
        const content = response.choices[0]?.message?.content;
        if (content) {
          try {
            // Try to extract JSON from the content
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              if (this.enableCaching) {
                this.cache.set(cacheOptions, result, options.requestId);
              }
              return { data: result, response: response } as T;
            }
          } catch (e) {
            logger({
              category: "groq",
              message: "failed to parse content as JSON",
              level: 0,
              auxiliary: {
                error: {
                  value: e.message,
                  type: "string",
                },
              },
            });
          }
        }

        // If we still haven't found valid JSON and have retries left, try again
        if (!retries || retries < 5) {
          return this.createChatCompletion({
            options,
            logger,
            retries: (retries ?? 0) + 1,
          });
        }

        throw new CreateChatCompletionResponseError("Invalid response schema");
      }

      if (this.enableCaching) {
        this.cache.set(cacheOptions, response, options.requestId);
      }

      return response as T;
    } catch (error) {
      logger({
        category: "groq",
        message: "error creating chat completion",
        level: 0,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });
      throw error;
    }
  }

  async createChatCompletionStream<T = StreamingChatResponse>({
    options,
    logger,
    retries = 3,
  }: CreateChatCompletionOptions): Promise<T> {
    const optionsWithoutImage = { ...options };
    delete optionsWithoutImage.image;

    logger({
      category: "groq",
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
      model: this.modelName.split("groq-")[1],
      messages: options.messages,
      temperature: options.temperature,
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
      }
    }

    // Format messages for Groq API (using OpenAI format)
    const formattedMessages = options.messages.map((msg: ChatMessage) => {
      const baseMessage = {
        content:
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content) &&
                msg.content.length > 0 &&
                "text" in msg.content[0]
              ? msg.content[0].text
              : "",
      };

      // Groq supports system, user, and assistant roles
      if (msg.role === "system") {
        return { ...baseMessage, role: "system" as const };
      } else if (msg.role === "assistant") {
        return { ...baseMessage, role: "assistant" as const };
      } else {
        // Default to user for any other role
        return { ...baseMessage, role: "user" as const };
      }
    });

    // Format tools if provided
    let tools = options.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));

    // Add response model as a tool if provided
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const schemaProperties = jsonSchema.properties || {};
      const schemaRequired = jsonSchema.required || [];

      const responseTool = {
        type: "function" as const,
        function: {
          name: "print_extracted_data",
          description:
            "Prints the extracted data based on the provided schema.",
          parameters: {
            type: "object",
            properties: schemaProperties,
            required: schemaRequired,
          },
        },
      };

      tools = tools ? [...tools, responseTool] : [responseTool];
    }

    // Use OpenAI client with Groq API
    const apiResponse = await this.client.chat.completions.create({
      model: this.modelName.split("groq-")[1],
      messages: [
        ...formattedMessages,
        // Add explicit instruction to return JSON if we have a response model
        ...(options.response_model
          ? [
              {
                role: "system" as const,
                content: `IMPORTANT: Your response must be valid JSON that matches this schema: ${JSON.stringify(options.response_model.schema)}`,
              },
            ]
          : []),
      ],
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens,
      tools: tools,
      tool_choice: options.tool_choice || "auto",
      stream: true,
    });

    // TODO: transform response to required format
    // TODO: Validate response model
    // TODO: Enable caching

    return apiResponse as T;
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
      category: "groq",
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
        category: "groq",
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
        category: "groq",
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

    // Log the generation attempt
    logger({
      category: "groq",
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
        model: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    try {
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
      if (
        !response.choices ||
        response.choices.length === 0 ||
        response.choices[0].message.content == null ||
        response.choices[0].message.content === undefined
      ) {
        logger({
          category: "groq",
          message: "Text generation failed",
          level: 0,
          auxiliary: {
            error: {
              value: "API response contains no valid choices",
              type: "string",
            },
            prompt: {
              value: prompt,
              type: "string",
            },
          },
        });

        throw new CreateChatCompletionResponseError(
          "API response contains no valid choices",
        );
      }

      // Extract and validate the generated text
      const generatedContent = response.choices[0].message.content;

      // Construct the final response
      const textResponse = {
        text: generatedContent,
        finishReason: response.choices[0].finish_reason,
        usage: response.usage,
        response: response,
        // reasoning: response.reasoning,
        // sources: response.sources
      } as T;

      // Log successful generation
      logger({
        category: "groq",
        message: "Text generation successful",
        level: 2,
        auxiliary: {
          requestId: {
            value: requestId,
            type: "string",
          },
          responseLength: {
            value: generatedContent.length.toString(),
            type: "string",
          },
          usage: {
            value: JSON.stringify(response.usage),
            type: "object",
          },
        },
      });

      return textResponse;
    } catch (error) {
      // Log the error with detailed information
      logger({
        category: "groq",
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
          model: {
            value: this.modelName,
            type: "string",
          },
        },
      });

      // If it's a known error type, throw it directly
      if (error instanceof CreateChatCompletionResponseError) {
        throw error;
      }

      // Otherwise, wrap it in our custom error type
      throw new CreateChatCompletionResponseError(
        `Failed to generate text: ${error.message}`,
      );
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

    // Log the generation attempt
    logger({
      category: "groq",
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

    try {
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
      if (
        !response.data ||
        response.data.length === 0 ||
        response.data === undefined
      ) {
        logger({
          category: "groq",
          message: "Object generation failed",
          level: 0,
          auxiliary: {
            error: {
              value: "API response contains no valid choices",
              type: "string",
            },
            prompt: {
              value: prompt,
              type: "string",
            },
          },
        });

        throw new CreateChatCompletionResponseError(
          "API response contains no valid choices",
        );
      }

      // Extract and validate the generated text
      const generatedObject = response.data;

      // Construct the final response
      const objResponse = {
        object: generatedObject,
        finishReason: response.response.choices[0].finish_reason,
        usage: response.response.usage,
        ...response,
      } as T;

      // Log successful generation
      logger({
        category: "groq",
        message: "Object generation successful",
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
        category: "groq",
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
