import {
  ModelMessage,
  ImagePart,
  NoObjectGeneratedError,
  Output,
  TextPart,
  ToolSet,
  Tool,
} from "ai";
import * as ai from "ai";
import { wrapAISDK } from "braintrust";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { ChatCompletion } from "openai/resources";
import { LogLine } from "@browserbasehq/stagehand/lib/v3/types/public/logs";
import { AvailableModel } from "@browserbasehq/stagehand/lib/v3/types/public/model";
import {
  CreateChatCompletionOptions,
  LLMClient,
} from "@browserbasehq/stagehand/lib/v3/llm/LLMClient";
import { toJsonSchema } from "@browserbasehq/stagehand/lib/v3/zodCompat";

// Wrap AI SDK functions with Braintrust for tracing
const { generateText } = wrapAISDK(ai);

export class AISdkClientWrapped extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV3;
  private logger?: (message: LogLine) => void;

  constructor({
    model,
    logger,
  }: {
    model: LanguageModelV3;
    logger?: (message: LogLine) => void;
  }) {
    super(model.modelId as AvailableModel);
    this.model = model;
    this.logger = logger;
  }

  public getLanguageModel(): LanguageModelV3 {
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
            const systemMessage: ModelMessage = {
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
            const userMessage: ModelMessage = {
              role: "user",
              content: contentParts,
            };
            return userMessage;
          } else {
            const textOnlyParts = contentParts.map((part) => ({
              type: "text" as const,
              text: part.type === "image" ? "[Image]" : part.text,
            }));
            const assistantMessage: ModelMessage = {
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

    let objectResponse: Awaited<ReturnType<typeof generateText>>;
    const isGPT5 = this.model.modelId.includes("gpt-5");
    const isCodex = this.model.modelId.includes("codex");
    const usesLowReasoningEffort =
      (this.model.modelId.includes("gpt-5.1") ||
        this.model.modelId.includes("gpt-5.2")) &&
      !isCodex;
    const isDeepSeek = this.model.modelId.includes("deepseek");
    // Kimi models only support temperature=1
    const isKimi = this.model.modelId.includes("kimi");
    const temperature = isKimi ? 1 : options.temperature;
    if (options.response_model) {
      if (isDeepSeek || isKimi) {
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
        objectResponse = await generateText({
          model: this.model,
          messages: formattedMessages,
          output: Output.object({
            schema: options.response_model.schema,
          }),
          temperature,
          providerOptions: isGPT5
            ? {
                openai: {
                  textVerbosity: isCodex ? "medium" : "low", // codex models only support 'medium'
                  reasoningEffort: isCodex
                    ? "medium"
                    : usesLowReasoningEffort
                      ? "low"
                      : "minimal",
                },
              }
            : undefined,
        });
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

      const usage = objectResponse.usage;
      const result = {
        data: objectResponse.output,
        usage: {
          prompt_tokens: usage.inputTokens ?? 0,
          completion_tokens: usage.outputTokens ?? 0,
          reasoning_tokens: usage.outputTokenDetails.reasoningTokens ?? 0,
          cached_input_tokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
          total_tokens: usage.totalTokens ?? 0,
        },
      } as T;

      this.logger?.({
        category: "aisdk",
        message: "response",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify({
              object: objectResponse.output,
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
      temperature,
    });

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
      usage: (() => {
        const u = textResponse.usage;
        return {
          prompt_tokens: u.inputTokens ?? 0,
          completion_tokens: u.outputTokens ?? 0,
          reasoning_tokens: u.outputTokenDetails.reasoningTokens ?? 0,
          cached_input_tokens: u.inputTokenDetails.cacheReadTokens ?? 0,
          total_tokens: u.totalTokens ?? 0,
        };
      })(),
    } as T;

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
