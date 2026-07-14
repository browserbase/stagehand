import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { ImagePart, LanguageModel, ModelMessage, TextPart, Tool, ToolSet } from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { z } from "zod/v4";
import type { ClientOptions, ModelName } from "../../protocol/types.js";
import { CreateChatCompletionOptions, LLMClient, type LLMResponse } from "./LLMClient.js";
import { ChatCompletionOptionsSchema } from "./schemas.js";
import { anthropicFallbacksOptions } from "./anthropicOptions.js";

type ProviderOptionValue = JSONValue;
type ProviderOptionMap = Record<string, ProviderOptionValue>;

function summarizeLlmPrompt(messages: unknown, options?: unknown): string {
  return JSON.stringify({ messages, options });
}

function inferProviderName(modelId: string): string | undefined {
  const [providerName] = modelId.split("/");
  return providerName || undefined;
}

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  // Compile-only bridge: accept the broad AI SDK model union until the final LLM boundary is chosen.
  private model: LanguageModel;
  private modelId: string;

  constructor({
    model,
    modelName,
    clientOptions,
  }: {
    model: LanguageModel;
    modelName: ModelName;
    clientOptions?: ClientOptions;
  }) {
    super(modelName);
    this.model = model;
    this.modelId = modelName;
    if (clientOptions) {
      this.clientOptions = clientOptions;
    }
  }

  public getLanguageModel(): LanguageModel {
    return this.model;
  }

  async createChatCompletion<T = LLMResponse>({
    options: optionsInitial,
    logger,
  }: CreateChatCompletionOptions): Promise<T> {
    const options = ChatCompletionOptionsSchema.parse(optionsInitial);
    const { llmRequestId } = options;

    logger.debug("Creating chat completion", {
      category: "aisdk",
      options: JSON.stringify({
        ...options,
        image: undefined,
        messages: options.messages.map((message) => ({
          ...message,
          content: Array.isArray(message.content)
            ? message.content.map((content) =>
                "image_url" in content
                  ? { ...content, image_url: { url: "[IMAGE_REDACTED]" } }
                  : content,
              )
            : message.content,
        })),
      }),
      modelName: this.modelId,
    });

    const formattedMessages: ModelMessage[] = options.messages.map((message) => {
      if (Array.isArray(message.content)) {
        if (message.role === "system") {
          const systemMessage = {
            role: "system",
            content: message.content.map((c) => ("text" in c ? c.text : "")).join("\n"),
          } as ModelMessage;
          return systemMessage;
        }

        const contentParts = message.content.map((content) => {
          if (content.type === "image_url") {
            const imageContent: ImagePart = {
              type: "image",
              image: content.image_url.url,
            };
            return imageContent;
          }

          if (content.type === "image") {
            const imageContent: ImagePart = {
              type: "image",
              image: `data:${content.source.media_type};base64,${content.source.data}`,
            };
            return imageContent;
          }

          {
            const textContent: TextPart = {
              type: "text",
              text: content.text,
            };
            return textContent;
          }
        });

        if (message.role === "user") {
          const userMessage = {
            role: "user",
            content: contentParts,
          } as ModelMessage;
          return userMessage;
        } else {
          const textOnlyParts = contentParts.map((part) => ({
            type: "text" as const,
            text: part.type === "image" ? "[Image]" : part.text,
          }));
          const assistantMessage = {
            role: "assistant",
            content: textOnlyParts,
          } as ModelMessage;
          return assistantMessage;
        }
      }

      return {
        role: message.role,
        content: message.content,
      };
    });

    const isGPT5 = this.modelId.includes("gpt-5");
    const isCodex = this.modelId.includes("codex");

    // Resolve reasoning effort: user-configured > default "none" for GPT-5.x sub-models
    const isGPT5SubModel = this.modelId.includes("gpt-5.") && !isCodex;
    const userReasoningEffort = (this.clientOptions as ClientOptions | undefined)?.reasoningEffort;
    const resolvedReasoningEffort = userReasoningEffort ?? (isGPT5SubModel ? "none" : undefined);
    const providerName = inferProviderName(this.modelId);

    // Models that lack native structured-output support need a prompt-based
    // JSON fallback instead of response_format: { type: "json_schema" }.
    const PROMPT_JSON_FALLBACK_PATTERNS = ["deepseek", "kimi", "glm"];
    const needsPromptJsonFallback = PROMPT_JSON_FALLBACK_PATTERNS.some((p) =>
      this.modelId.includes(p),
    );

    const providerOptions: Record<string, ProviderOptionMap> = {};
    switch (providerName) {
      case "openai":
        providerOptions.openai = {
          strictJsonSchema: true,
          ...(isGPT5 ? { textVerbosity: isCodex ? "medium" : "low" } : {}),
          ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
        };
        break;
      case "anthropic":
        providerOptions.anthropic = {
          structuredOutputMode: "auto",
          // Fable 5 opts into the API's server-side refusal fallback; the
          // provider adds the required beta header automatically.
          ...anthropicFallbacksOptions(this.modelId),
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
      // Log LLM request for structured generation (extract)
      const promptSummary = summarizeLlmPrompt(options.messages, {
        hasSchema: true,
      });
      logger.debug("LLM request", {
        requestId: llmRequestId,
        model: this.modelId,
        prompt: promptSummary,
      });

      // For models that don't support native structured outputs, add a prompt instruction
      if (needsPromptJsonFallback) {
        const parsedSchema = JSON.stringify(z.toJSONSchema(options.response_model.schema));

        formattedMessages.push({
          role: "user",
          content: `Respond in this zod schema format:\n${parsedSchema}\n
You must respond in JSON format. respond WITH JSON. Do not include any other text, formatting or markdown in your output. Do not include \`\`\` or \`\`\`json in your response. Only the JSON object itself.`,
        });
      }

      let objectResponse: Awaited<ReturnType<typeof generateText>>;
      try {
        let invalidOutputRetriesRemaining = options.maxRetries;
        while (true) {
          try {
            objectResponse = await generateText({
              model: this.model,
              messages: formattedMessages,
              output: Output.object({
                name: options.response_model.name,
                schema: options.response_model.schema,
              }),
              maxRetries: options.maxRetries,
              ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
            });
            break;
          } catch (err) {
            if (!NoObjectGeneratedError.isInstance(err) || invalidOutputRetriesRemaining === 0) {
              throw err;
            }
            invalidOutputRetriesRemaining -= 1;
          }
        }
      } catch (err) {
        // Log error response to maintain request/response pairing
        logger.error("LLM request failed", {
          requestId: llmRequestId,
          model: this.modelId,
          error: err instanceof Error ? err.message : "unknown",
        });

        if (NoObjectGeneratedError.isInstance(err)) {
          logger.error("AI SDK failed to generate an object", {
            category: "AISDK error",
            error: err.message,
            cause: JSON.stringify(err.cause ?? {}),
            text: err.text ?? "",
            response: JSON.stringify(err.response ?? {}),
            usage: JSON.stringify(err.usage ?? {}),
            finishReason: err.finishReason ?? "unknown",
            llmRequestId,
          });

          throw err;
        }
        throw err;
      }

      const result = {
        data: objectResponse.output,
        usage: {
          prompt_tokens: objectResponse.usage.inputTokens ?? 0,
          completion_tokens: objectResponse.usage.outputTokens ?? 0,
          reasoning_tokens:
            (objectResponse.usage as { reasoningTokens?: number }).reasoningTokens ?? 0,
          cached_input_tokens:
            (objectResponse.usage as { cachedInputTokens?: number }).cachedInputTokens ?? 0,
          total_tokens: objectResponse.usage.totalTokens ?? 0,
        },
      } as T;

      // Log LLM response for structured generation
      logger.info("LLM response", {
        category: "aisdk",
        requestId: llmRequestId,
        model: this.modelId,
        output: JSON.stringify(objectResponse.output),
        inputTokens: objectResponse.usage.inputTokens ?? null,
        outputTokens: objectResponse.usage.outputTokens ?? null,
        finishReason: objectResponse.finishReason,
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
    const toolCount = Object.keys(tools).length;
    const promptSummary = summarizeLlmPrompt(options.messages, {
      toolCount,
    });
    logger.debug("LLM request", {
      requestId: llmRequestId,
      model: this.modelId,
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
        maxRetries: options.maxRetries,
      });
    } catch (err) {
      // Log error response to maintain request/response pairing
      logger.error("LLM request failed", {
        requestId: llmRequestId,
        model: this.modelId,
        error: err instanceof Error ? err.message : "unknown",
      });
      throw err;
    }

    // Transform AI SDK response to match LLMResponse format expected by operator handler
    const transformedToolCalls = (textResponse.toolCalls || []).map((toolCall) => ({
      id: toolCall.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "function",
      function: {
        name: toolCall.toolName,
        arguments: JSON.stringify(toolCall.input),
      },
    }));

    const result = {
      id: `chatcmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.modelId,
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
        reasoning_tokens: (textResponse.usage as { reasoningTokens?: number }).reasoningTokens ?? 0,
        cached_input_tokens:
          (textResponse.usage as { cachedInputTokens?: number }).cachedInputTokens ?? 0,
        total_tokens: textResponse.usage.totalTokens ?? 0,
      },
    } as T;

    // Log LLM response for generateText
    logger.debug("LLM response", {
      category: "aisdk",
      requestId: llmRequestId,
      model: this.modelId,
      output:
        textResponse.text ||
        (transformedToolCalls.length > 0 ? `[${transformedToolCalls.length} tool calls]` : ""),
      inputTokens: textResponse.usage.inputTokens ?? null,
      outputTokens: textResponse.usage.outputTokens ?? null,
      finishReason: textResponse.finishReason,
    });

    return result;
  }
}
