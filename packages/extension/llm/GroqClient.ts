import type { ClientOptions as OpenAISDKClientOptions } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import OpenAI from "openai";
import { z } from "zod/v4";
import { LogLine } from "../types/public/logs.js";
import { ApiKeyClientOptions, AvailableModel } from "../types/public/model.js";
import { ChatMessage, CreateChatCompletionOptions, LLMClient, LLMResponse } from "./LLMClient.js";
import { ChatCompletionOptionsSchema } from "./schemas.js";
import { CreateChatCompletionResponseError } from "../types/public/sdkErrors.js";

export class GroqClient extends LLMClient {
  public type = "groq" as const;
  private client: OpenAI;
  declare public clientOptions: ApiKeyClientOptions;
  public hasVision = false;

  constructor({
    modelName,
    clientOptions,
    userProvidedInstructions,
  }: {
    logger: (message: LogLine) => void;
    modelName: AvailableModel;
    clientOptions: ApiKeyClientOptions;
    userProvidedInstructions?: string;
  }) {
    super(modelName, userProvidedInstructions);

    // Create OpenAI client with the base URL set to Groq API
    const { auth, headers, baseURL, organization } = clientOptions;
    this.client = new OpenAI({
      baseURL: baseURL ?? "https://api.groq.com/openai/v1",
      apiKey: auth.apiKey,
      ...(organization ? { organization } : {}),
      ...(headers ? { defaultHeaders: headers } : {}),
    } satisfies OpenAISDKClientOptions);

    this.modelName = modelName;
    this.clientOptions = clientOptions;
  }

  async createChatCompletion<T = LLMResponse>({
    options: optionsInitial,
    retries,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const options = ChatCompletionOptionsSchema.parse(optionsInitial);
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

    // Format messages for Groq API (using OpenAI format)
    const formattedMessages: ChatCompletionMessageParam[] = options.messages.map(
      (msg: ChatMessage) => {
        const firstContentPart = Array.isArray(msg.content) ? msg.content[0] : undefined;
        const baseMessage = {
          content:
            typeof msg.content === "string"
              ? msg.content
              : firstContentPart?.type === "text"
                ? firstContentPart.text
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
      },
    );

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
      const jsonSchema = z.toJSONSchema(options.response_model.schema) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const schemaProperties = jsonSchema.properties || {};
      const schemaRequired = jsonSchema.required || [];

      const responseTool = {
        type: "function" as const,
        function: {
          name: "print_extracted_data",
          description: "Prints the extracted data based on the provided schema.",
          parameters: {
            type: "object",
            properties: schemaProperties,
            required: schemaRequired,
          },
        },
      };

      tools = tools ? [...tools, responseTool] : [responseTool];
    }

    const groqModelName = this.modelName.split("groq-")[1] ?? this.modelName;

    try {
      // Use OpenAI client with Groq API
      const apiResponse = await this.client.chat.completions.create({
        model: groqModelName,
        messages: [
          ...formattedMessages,
          // Add explicit instruction to return JSON if we have a response model
          ...(options.response_model
            ? [
                {
                  role: "system" as const,
                  content: `IMPORTANT: Your response must be valid JSON that matches this schema: ${JSON.stringify(
                    options.response_model.schema,
                  )}`,
                },
              ]
            : []),
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxOutputTokens,
        tools: tools,
        tool_choice: options.tool_choice || "auto",
      });

      // Format the response to match the expected LLMResponse format
      const response: LLMResponse = {
        id: apiResponse.id,
        object: "chat.completion",
        created: Date.now(),
        model: groqModelName,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: apiResponse.choices[0]?.message?.content || null,
              // Compile-only bridge: current OpenAI-compatible tool calls are wider than V3's LLMResponse.
              tool_calls: (apiResponse.choices[0]?.message?.tool_calls as never) || [],
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
          llmRequestId: {
            value: options.llmRequestId,
            type: "string",
          },
        },
      });

      // If there's no response model, return the entire response object
      if (!options.response_model) {
        return response as T;
      }

      // Otherwise, try parsing the JSON from the tool call or content
      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try {
          const result = JSON.parse(toolCall.function.arguments);
          const finalResponse = {
            data: result,
            usage: response.usage,
          };
          return finalResponse as T;
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown";
          logger({
            category: "groq",
            message: "failed to parse tool call arguments as JSON, retrying",
            level: 0,
            auxiliary: {
              error: {
                value: message,
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
            const finalResponse = {
              data: result,
              usage: response.usage,
            };
            return finalResponse as T;
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown";
          logger({
            category: "groq",
            message: "failed to parse content as JSON",
            level: 0,
            auxiliary: {
              error: {
                value: message,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logger({
        category: "groq",
        message: "error creating chat completion",
        level: 0,
        auxiliary: {
          error: {
            value: message,
            type: "string",
          },
          llmRequestId: {
            value: options.llmRequestId,
            type: "string",
          },
        },
      });
      throw error;
    }
  }
}
