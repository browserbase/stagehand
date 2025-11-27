import {
  CoreAssistantMessage,
  ModelMessage,
  CoreSystemMessage,
  CoreUserMessage,
  generateObject,
  generateText,
  ImagePart,
  NoObjectGeneratedError,
  TextPart,
  ToolSet,
  Tool,
} from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { LogLine } from "../types/public/logs";
import { AvailableModel, ClientOptions } from "../types/public/model";
import {
  CreateChatCompletionOptions,
  LLMClient,
  LLMResponse,
} from "./LLMClient";

// Type for claude-code model names
export type ClaudeCodeModelName =
  | "claude-code-opus"
  | "claude-code-sonnet"
  | "claude-code-haiku";

// Map from Stagehand model names to claude-code provider model names
const claudeCodeModelMap: Record<ClaudeCodeModelName, string> = {
  "claude-code-opus": "opus",
  "claude-code-sonnet": "sonnet",
  "claude-code-haiku": "haiku",
};

export class ClaudeCodeClient extends LLMClient {
  public type = "claude-code" as const;
  private model: LanguageModelV2;
  private logger?: (message: LogLine) => void;

  constructor({
    modelName,
    logger,
    clientOptions,
  }: {
    modelName: ClaudeCodeModelName;
    logger?: (message: LogLine) => void;
    clientOptions?: ClientOptions;
  }) {
    super(modelName as AvailableModel);
    this.logger = logger;
    this.clientOptions = clientOptions;

    // Dynamically import the claude-code provider
    // This is done lazily to avoid requiring the package if not used
    const providerModelName = claudeCodeModelMap[modelName];
    this.model = this.createClaudeCodeModel(providerModelName);
  }

  private createClaudeCodeModel(modelName: string): LanguageModelV2 {
    // Dynamic require to handle optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let claudeCode: (modelName: string) => LanguageModelV2;
    try {
      // Try to import the claude-code provider
      const provider = require("ai-sdk-provider-claude-code");
      claudeCode = provider.claudeCode;
    } catch {
      throw new Error(
        "ai-sdk-provider-claude-code package is not installed. " +
          "Please install it with: npm install ai-sdk-provider-claude-code\n" +
          "Also ensure Claude Code CLI is installed and authenticated via 'claude login'.",
      );
    }
    return claudeCode(modelName);
  }

  public getLanguageModel(): LanguageModelV2 {
    return this.model;
  }

  async createChatCompletion<T = LLMResponse>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    this.logger?.({
      category: "claude-code",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        options: {
          value: JSON.stringify({
            ...options,
            image: undefined,
            messages: options.messages.map((msg) => ({
              ...msg,
              content: Array.isArray(msg.content)
                ? msg.content.map((c) =>
                    "image_url" in c
                      ? { ...c, image_url: { url: "[IMAGE_REDACTED]" } }
                      : c,
                  )
                : msg.content,
            })),
          }),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    const formattedMessages: ModelMessage[] = options.messages.map(
      (message) => {
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
      },
    );

    // Add image to messages if provided
    if (options.image) {
      formattedMessages.push({
        role: "user",
        content: [
          {
            type: "image",
            image: options.image.buffer.toString("base64"),
          } as ImagePart,
          ...(options.image.description
            ? [{ type: "text" as const, text: options.image.description }]
            : []),
        ],
      });
    }

    let objectResponse: Awaited<ReturnType<typeof generateObject>>;
    if (options.response_model) {
      try {
        objectResponse = await generateObject({
          model: this.model,
          messages: formattedMessages,
          schema: options.response_model.schema,
          temperature: options.temperature,
        });
      } catch (err) {
        if (NoObjectGeneratedError.isInstance(err)) {
          this.logger?.({
            category: "claude-code error",
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
        data: objectResponse.object,
        usage: {
          prompt_tokens: objectResponse.usage.inputTokens ?? 0,
          completion_tokens: objectResponse.usage.outputTokens ?? 0,
          reasoning_tokens: objectResponse.usage.reasoningTokens ?? 0,
          cached_input_tokens: objectResponse.usage.cachedInputTokens ?? 0,
          total_tokens: objectResponse.usage.totalTokens ?? 0,
        },
      } as T;

      this.logger?.({
        category: "claude-code",
        message: "response",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify({
              object: objectResponse.object,
              usage: objectResponse.usage,
              finishReason: objectResponse.finishReason,
            }),
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

    const tools: ToolSet = {};
    if (options.tools && options.tools.length > 0) {
      for (const tool of options.tools) {
        tools[tool.name] = {
          description: tool.description,
          inputSchema: tool.parameters,
        } as Tool;
      }
    }

    const textResponse = await generateText({
      model: this.model,
      messages: formattedMessages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      toolChoice:
        Object.keys(tools).length > 0
          ? options.tool_choice === "required"
            ? "required"
            : options.tool_choice === "none"
              ? "none"
              : "auto"
          : undefined,
      temperature: options.temperature,
    });

    // Transform AI SDK response to match LLMResponse format
    const transformedToolCalls = (textResponse.toolCalls || []).map(
      (toolCall) => ({
        id:
          toolCall.toolCallId ||
          `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: "function",
        function: {
          name: toolCall.toolName,
          arguments: JSON.stringify(toolCall.input),
        },
      }),
    );

    const result = {
      id: `chatcmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textResponse.text || null,
            tool_calls: transformedToolCalls,
          },
          finish_reason: textResponse.finishReason || "stop",
        },
      ],
      usage: {
        prompt_tokens: textResponse.usage.inputTokens ?? 0,
        completion_tokens: textResponse.usage.outputTokens ?? 0,
        reasoning_tokens: textResponse.usage.reasoningTokens ?? 0,
        cached_input_tokens: textResponse.usage.cachedInputTokens ?? 0,
        total_tokens: textResponse.usage.totalTokens ?? 0,
      },
    } as T;

    this.logger?.({
      category: "claude-code",
      message: "response",
      level: 2,
      auxiliary: {
        response: {
          value: JSON.stringify({
            text: textResponse.text,
            usage: textResponse.usage,
            finishReason: textResponse.finishReason,
          }),
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
