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

type ProviderOptionValue = string | number | boolean | null;
type ProviderOptionMap = Record<string, ProviderOptionValue>;

function inferProviderName(modelId: string): string | undefined {
  const [providerName] = modelId.split("/");
  return providerName || undefined;
}

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV2;
  private logger?: (message: LogLine) => void;

  constructor({
    model,
    logger,
    clientOptions,
  }: {
    model: LanguageModelV2;
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

  public getLanguageModel(): LanguageModelV2 {
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

    let objectResponse: Awaited<ReturnType<typeof generateObject>>;
    const isGPT5 = this.model.modelId.includes("gpt-5");
    const isCodex = this.model.modelId.includes("codex");
    const isOpus47 =
      this.model.modelId === "anthropic/claude-opus-4-7" ||
      this.model.modelId === "claude-opus-4-7";
    // Kimi models only support temperature=1
    const isKimi = this.model.modelId.includes("kimi");
    const temperature = isKimi ? 1 : isOpus47 ? undefined : options.temperature;

    // Resolve reasoning effort: user-configured > default "none" for GPT-5.x sub-models
    const isGPT5SubModel = this.model.modelId.includes("gpt-5.") && !isCodex;
    const userReasoningEffort = this.clientOptions?.reasoningEffort;
    const resolvedReasoningEffort =
      userReasoningEffort ?? (isGPT5SubModel ? "none" : undefined);
    const providerName = inferProviderName(this.model.modelId);

    // Models that lack native structured-output support need a prompt-based
    // JSON fallback instead of response_format: { type: "json_schema" }.
    const PROMPT_JSON_FALLBACK_PATTERNS = ["deepseek", "kimi", "glm"];
    const needsPromptJsonFallback = PROMPT_JSON_FALLBACK_PATTERNS.some((p) =>
      this.model.modelId.includes(p),
    );

    const providerOptions: Record<string, ProviderOptionMap> = {};
    switch (providerName) {
      case "openai":
        providerOptions.openai = {
          strictJsonSchema: true,
          ...(isGPT5 ? { textVerbosity: isCodex ? "medium" : "low" } : {}),
          ...(resolvedReasoningEffort
            ? { reasoningEffort: resolvedReasoningEffort }
            : {}),
        };
        break;
      case "anthropic":
        providerOptions.anthropic = {
          structuredOutputMode: "auto",
        };
        break;
      case "azure":
        providerOptions.azure = {
          strictJsonSchema: true,
        };
        break;
      case "google":
        providerOptions.google = {
          structuredOutputs: true,
        };
        break;
      case "vertex":
        providerOptions.vertex = {
          structuredOutputs: true,
        };
        break;
      case "groq":
        providerOptions.groq = {
          structuredOutputs: true,
        };
        break;
      case "cerebras":
        providerOptions.cerebras = {
          strictJsonSchema: true,
        };
        break;
      case "mistral":
        providerOptions.mistral = {
          structuredOutputs: true,
          strictJsonSchema: true,
        };
        break;
    }

    if (options.response_model) {
      // Log LLM request for generateObject (extract)
      const llmRequestId = uuidv7();
      const promptSummary = extractLlmPromptSummary(options.messages, {
        hasSchema: true,
      });
      FlowLogger.logLlmRequest({
        requestId: llmRequestId,
        model: this.model.modelId,
        prompt: promptSummary,
      });

      // For models that don't support native structured outputs, add a prompt instruction
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
        objectResponse = await generateObject({
          model: this.model,
          messages: formattedMessages,
          schema: options.response_model.schema,
          temperature,
          ...(Object.keys(providerOptions).length > 0
            ? { providerOptions }
            : {}),
        });
      } catch (err) {
        // Log error response to maintain request/response pairing
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

      // Log LLM response for generateObject
      FlowLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.model.modelId,
        output: JSON.stringify(objectResponse.object),
        inputTokens: objectResponse.usage.inputTokens,
        outputTokens: objectResponse.usage.outputTokens,
      });

      this.logger?.({
        category: "aisdk",
        message: "response",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify({
              object: objectResponse.object,
              usage: objectResponse.usage,
              finishReason: objectResponse.finishReason,
              // Omit request and response properties that might contain images
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

    // Log LLM request for generateText (act/observe)
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

    let textResponse: Awaited<ReturnType<typeof generateText>>;
    try {
      textResponse = await generateText({
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
        temperature,
      });
    } catch (err) {
      // Log error response to maintain request/response pairing
      FlowLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.model.modelId,
        output: `[error: ${err instanceof Error ? err.message : "unknown"}]`,
      });
      throw err;
    }

    // Transform AI SDK response to match LLMResponse format expected by operator handler
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
      usage: {
        prompt_tokens: textResponse.usage.inputTokens ?? 0,
        completion_tokens: textResponse.usage.outputTokens ?? 0,
        reasoning_tokens: textResponse.usage.reasoningTokens ?? 0,
        cached_input_tokens: textResponse.usage.cachedInputTokens ?? 0,
        total_tokens: textResponse.usage.totalTokens ?? 0,
      },
    } as T;

    // Log LLM response for generateText
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
            // Omit request and response properties that might contain images
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
