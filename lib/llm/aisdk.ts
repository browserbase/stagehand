import {
  CoreAssistantMessage,
  CoreMessage,
  CoreSystemMessage,
  CoreTool,
  CoreUserMessage,
  generateText,
  ImagePart,
  LanguageModel,
  NoObjectGeneratedError,
  Output,
  TextPart,
  Tool,
} from "ai";
import { ChatCompletion } from "openai/resources";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { CreateChatCompletionOptions, LLMClient } from "./LLMClient";

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModel;
  private logger?: (message: LogLine) => void;
  private cache: LLMCache | undefined;
  private enableCaching: boolean;
  public tools?: { [k: string]: Tool };

  constructor({
    model,
    logger,
    enableCaching = false,
    cache,
    tools,
  }: {
    model: LanguageModel;
    logger?: (message: LogLine) => void;
    enableCaching?: boolean;
    cache?: LLMCache;
    tools?: { [k: string]: Tool };
  }) {
    super(model.modelId as AvailableModel);
    this.model = model;
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.tools = tools;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    this.logger?.({
      category: "aisdk",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify(options),
          type: "object",
        },
        modelName: {
          value: this.model.modelId,
          type: "string",
        },
      },
    });

    const cacheOptions = {
      model: this.model.modelId,
      messages: options.messages,
      response_model: options.response_model,
    };

    if (this.enableCaching && this.cache) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        options.requestId,
      );
      if (cachedResponse) {
        this.logger?.({
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
      } else {
        this.logger?.({
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
    }

    const formattedMessages: CoreMessage[] = options.messages.map((message) => {
      if (Array.isArray(message.content)) {
        if (message.role === "system") {
          const systemMessage: CoreSystemMessage = {
            role: "system",
            content: message.content
              .map((c) => ("text" in c ? c.text : ""))
              .join("\n"),
          };
          return systemMessage;
        }

        const contentParts = message.content.map((content) => {
          if ("image_url" in content) {
            const imageContent: ImagePart = {
              type: "image",
              image: content.image_url.url,
            };
            return imageContent;
          } else {
            const textContent: TextPart = {
              type: "text",
              text: content.text,
            };
            return textContent;
          }
        });

        if (message.role === "user") {
          const userMessage: CoreUserMessage = {
            role: "user",
            content: contentParts,
          };
          return userMessage;
        } else {
          const textOnlyParts = contentParts.map((part) => ({
            type: "text" as const,
            text: part.type === "image" ? "[Image]" : part.text,
          }));
          const assistantMessage: CoreAssistantMessage = {
            role: "assistant",
            content: textOnlyParts,
          };
          return assistantMessage;
        }
      }

      return {
        role: message.role,
        content: message.content,
      };
    });

    let objectResponse: Awaited<ReturnType<typeof generateText>>;
    if (options.response_model) {
      try {
        objectResponse = await generateText({
          model: this.model,
          messages: formattedMessages,
          experimental_output: Output.object({
            schema: options.response_model.schema,
          }),
          tools: this.tools,
          maxSteps: 10,
        });

        if (objectResponse.toolCalls && objectResponse.toolCalls.length > 0) {
          this.logger?.({
            category: "aisdk_tool_calls",
            message: `Tool calls executed: ${objectResponse.toolCalls.length}`,
            level: 1,
            auxiliary: {
              toolCalls: {
                value: JSON.stringify(
                  objectResponse.toolCalls.map((tc) => ({
                    name: tc.toolName,
                    args: tc.toolCallId,
                  })),
                ),
                type: "object",
              },
              requestId: {
                value: options.requestId,
                type: "string",
              },
            },
          });
        }
      } catch (err) {
        if (NoObjectGeneratedError.isInstance(err)) {
          this.logger?.({
            category: "AISDK error",
            message: err.message,
            level: 0,
            auxiliary: {
              cause: {
                value: JSON.stringify(err.cause ?? {}),
                type: "object",
              },
              text: {
                value: err.text ?? "",
                type: "string",
              },
              response: {
                value: JSON.stringify(err.response ?? {}),
                type: "object",
              },
              usage: {
                value: JSON.stringify(err.usage ?? {}),
                type: "object",
              },
              finishReason: {
                value: err.finishReason ?? "unknown",
                type: "string",
              },
              requestId: {
                value: options.requestId,
                type: "string",
              },
            },
          });

          throw err;
        }
        throw err;
      }

      const result = {
        data: JSON.parse(objectResponse.text),
        usage: {
          prompt_tokens: objectResponse.usage.promptTokens ?? 0,
          completion_tokens: objectResponse.usage.completionTokens ?? 0,
          total_tokens: objectResponse.usage.totalTokens ?? 0,
        },
      } as T;

      if (this.enableCaching) {
        this.logger?.({
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
              value: JSON.stringify(result),
              type: "object",
            },
          },
        });
        this.cache.set(cacheOptions, result, options.requestId);
      }

      this.logger?.({
        category: "aisdk",
        message: "response",
        level: 2,
        auxiliary: {
          response: {
            value: JSON.stringify(objectResponse),
            type: "object",
          },
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });

      return result;
    }

    const tools: Record<string, CoreTool> = {};

    for (const rawTool of options.tools ?? []) {
      tools[rawTool.name] = {
        description: rawTool.description,
        parameters: rawTool.parameters,
      };
    }

    // Log when tools are being used for text generation
    const allTools = { ...tools, ...this.tools };
    if (Object.keys(allTools).length > 0) {
      this.logger?.({
        category: "aisdk_tools",
        message: "Using tools for text generation",
        level: 1,
        auxiliary: {
          availableTools: {
            value: Object.keys(allTools).join(", "),
            type: "string",
          },
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });
    }

    const textResponse = await generateText({
      model: this.model,
      messages: formattedMessages,
      tools: allTools,
      maxSteps: 10,
    });

    // Log tool call information if present
    if (textResponse.toolCalls && textResponse.toolCalls.length > 0) {
      this.logger?.({
        category: "aisdk_tool_calls",
        message: `Tool calls executed: ${textResponse.toolCalls.length}`,
        level: 1,
        auxiliary: {
          toolCalls: {
            value: JSON.stringify(
              textResponse.toolCalls.map((tc) => ({
                name: tc.toolName,
                args: tc.toolCallId,
              })),
            ),
            type: "object",
          },
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });
    }

    const result = {
      data: textResponse.text,
      usage: {
        prompt_tokens: textResponse.usage.promptTokens ?? 0,
        completion_tokens: textResponse.usage.completionTokens ?? 0,
        total_tokens: textResponse.usage.totalTokens ?? 0,
      },
    } as T;

    if (this.enableCaching) {
      this.logger?.({
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
            value: JSON.stringify(result),
            type: "object",
          },
        },
      });
      this.cache.set(cacheOptions, result, options.requestId);
    }

    this.logger?.({
      category: "aisdk",
      message: "response",
      level: 2,
      auxiliary: {
        response: {
          value: JSON.stringify(textResponse),
          type: "object",
        },
        requestId: {
          value: options.requestId,
          type: "string",
        },
      },
    });

    return result;
  }
}
