import {
  AssistantModelMessage,
  generateText,
  ImagePart,
  ModelMessage,
  NoObjectGeneratedError,
  Output,
  SystemModelMessage,
  TextPart,
  UserModelMessage,
  type Tool,
  type ToolSet,
} from "ai";
import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import { ChatCompletion } from "openai/resources";
import { v7 as uuidv7 } from "uuid";
import { LogLine } from "../types/public/logs.js";
import { AvailableModel, ClientOptions } from "../types/public/model.js";
import { CreateChatCompletionOptions, LLMClient } from "./LLMClient.js";
import {
  FlowLogger,
  extractLlmPromptSummary,
} from "../flowlogger/FlowLogger.js";
import { toJsonSchema } from "../zodCompat.js";

function getReasoningTokens(
  usage?: {
    outputTokenDetails?: { reasoningTokens?: number };
    reasoningTokens?: number;
  } | null,
): number {
  return (
    usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0
  );
}

function getCachedInputTokens(
  usage?: {
    inputTokenDetails?: { cacheReadTokens?: number };
    cachedInputTokens?: number;
  } | null,
): number {
  return (
    usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0
  );
}

function toLLMUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
  reasoningTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  cachedInputTokens?: number;
}) {
  return {
    prompt_tokens: usage?.inputTokens ?? 0,
    completion_tokens: usage?.outputTokens ?? 0,
    reasoning_tokens: getReasoningTokens(usage),
    cached_input_tokens: getCachedInputTokens(usage),
    total_tokens: usage?.totalTokens ?? 0,
  };
}

function buildOpenAiStructuredProviderOptions(options: {
  isGPT5: boolean;
  isCodex: boolean;
  reasoningEffort?: string;
}) {
  const openaiOptions: Record<string, string | boolean> = {};

  if (options.isGPT5) {
    openaiOptions.textVerbosity = options.isCodex ? "medium" : "low";
  }

  if (options.reasoningEffort) {
    openaiOptions.reasoningEffort = options.reasoningEffort;
  }

  return Object.keys(openaiOptions).length > 0
    ? { openai: openaiOptions }
    : undefined;
}

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV2 | LanguageModelV3;
  private logger?: (message: LogLine) => void;

  constructor({
    model,
    logger,
    clientOptions,
  }: {
    model: LanguageModelV2 | LanguageModelV3;
    logger?: (message: LogLine) => void;
    clientOptions?: ClientOptions;
  }) {
    super(model.modelId as AvailableModel);
    this.model = model;
    this.logger = logger;
    if (clientOptions) {
      this.clientOptions = clientOptions;
    }
  }

  public getLanguageModel(): LanguageModelV2 | LanguageModelV3 {
    return this.model;
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
          value: this.model.modelId,
          type: "string",
        },
      },
    });

    const formattedMessages: ModelMessage[] = options.messages.map(
      (message) => {
        if (Array.isArray(message.content)) {
          if (message.role === "system") {
            const systemMessage: SystemModelMessage = {
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
            const userMessage: UserModelMessage = {
              role: "user",
              content: contentParts,
            };
            return userMessage;
          } else {
            const textOnlyParts = contentParts.map((part) => ({
              type: "text" as const,
              text: part.type === "image" ? "[Image]" : part.text,
            }));
            const assistantMessage: AssistantModelMessage = {
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
    const isGPT5 = this.model.modelId.includes("gpt-5");
    const isCodex = this.model.modelId.includes("codex");
    // Kimi models only support temperature=1
    const isKimi = this.model.modelId.includes("kimi");
    const temperature = isKimi ? 1 : options.temperature;

    // Resolve reasoning effort: user-configured > default "none" for GPT-5.x sub-models
    const isGPT5SubModel = this.model.modelId.includes("gpt-5.") && !isCodex;
    const userReasoningEffort = this.clientOptions?.reasoningEffort;
    const resolvedReasoningEffort =
      userReasoningEffort ?? (isGPT5SubModel ? "none" : undefined);

    // Models that lack native structured-output support need a prompt-based
    // JSON fallback instead of response_format: { type: "json_schema" }.
    const PROMPT_JSON_FALLBACK_PATTERNS = ["deepseek", "kimi", "glm"];
    const needsPromptJsonFallback = PROMPT_JSON_FALLBACK_PATTERNS.some((p) =>
      this.model.modelId.includes(p),
    );

    if (options.response_model) {
      const llmRequestId = uuidv7();
      const promptSummary = extractLlmPromptSummary(options.messages, {
        hasSchema: true,
      });
      FlowLogger.logLlmRequest({
        requestId: llmRequestId,
        model: this.model.modelId,
        prompt: promptSummary,
      });

      if (needsPromptJsonFallback) {
        const parsedSchema = JSON.stringify(
          toJsonSchema(options.response_model.schema),
        );

        formattedMessages.push({
          role: "user",
          content: `Respond in this zod schema format:\n${parsedSchema}\n
You must respond in JSON format. respond WITH JSON. Do not include any other text, formatting or markdown in your output. Do not include \`\`\` or \`\`\`json in your response. Only the JSON object itself.`,
        });
      }

      try {
        const response = await generateText({
          model: this.model,
          messages: formattedMessages,
          output: Output.object({
            schema: options.response_model.schema,
            name: options.response_model.name,
          }),
          temperature,
          maxOutputTokens: options.maxOutputTokens,
          topP: options.top_p,
          frequencyPenalty: options.frequency_penalty,
          presencePenalty: options.presence_penalty,
          providerOptions: buildOpenAiStructuredProviderOptions({
            isGPT5,
            isCodex,
            reasoningEffort: resolvedReasoningEffort,
          }),
        });

        const result = {
          data: response.output,
          usage: toLLMUsage(response.usage),
        } as T;

        FlowLogger.logLlmResponse({
          requestId: llmRequestId,
          model: this.model.modelId,
          output: JSON.stringify(response.output),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        });

        this.logger?.({
          category: "aisdk",
          message: "response",
          level: 1,
          auxiliary: {
            response: {
              value: JSON.stringify({
                output: response.output,
                usage: response.usage,
                finishReason: response.finishReason,
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
      } catch (err) {
        FlowLogger.logLlmResponse({
          requestId: llmRequestId,
          model: this.model.modelId,
          output: `[error: ${err instanceof Error ? err.message : "unknown"}]`,
        });

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
        }

        throw err;
      }
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

    const llmRequestId = uuidv7();
    const toolCount = Object.keys(tools).length;
    const promptSummary = extractLlmPromptSummary(options.messages, {
      toolCount,
    });
    FlowLogger.logLlmRequest({
      requestId: llmRequestId,
      model: this.model.modelId,
      prompt: promptSummary,
    });

    try {
      const textResponse = await generateText({
        model: this.model,
        messages: formattedMessages,
        tools: toolCount > 0 ? tools : undefined,
        toolChoice:
          toolCount > 0
            ? options.tool_choice === "required"
              ? "required"
              : options.tool_choice === "none"
                ? "none"
                : "auto"
            : undefined,
        temperature,
        maxOutputTokens: options.maxOutputTokens,
        topP: options.top_p,
        frequencyPenalty: options.frequency_penalty,
        presencePenalty: options.presence_penalty,
      });

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
        model: this.model.modelId,
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
        usage: toLLMUsage(textResponse.usage),
      } as T;

      FlowLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.model.modelId,
        output:
          textResponse.text ||
          (transformedToolCalls.length > 0
            ? `[${transformedToolCalls.length} tool calls]`
            : ""),
        inputTokens: textResponse.usage.inputTokens,
        outputTokens: textResponse.usage.outputTokens,
      });

      this.logger?.({
        category: "aisdk",
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
    } catch (err) {
      FlowLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.model.modelId,
        output: `[error: ${err instanceof Error ? err.message : "unknown"}]`,
      });
      throw err;
    }
  }
}
