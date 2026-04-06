import {
  AssistantModelMessage,
  generateText,
  ImagePart,
  ModelMessage,
  Output,
  SystemModelMessage,
  TextPart,
  UserModelMessage,
  type Tool,
} from "ai";
import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import { CreateChatCompletionOptions, LLMClient } from "../llm/LLMClient.js";
import { AvailableModel } from "../types/public/index.js";
import { ChatCompletion } from "openai/resources";

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

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV2 | LanguageModelV3;

  constructor({ model }: { model: LanguageModelV2 | LanguageModelV3 }) {
    super(model.modelId as AvailableModel);
    this.model = model;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
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
            }

            const textContent: TextPart = {
              type: "text",
              text: content.text,
            };
            return textContent;
          });

          if (message.role === "user") {
            const userMessage: UserModelMessage = {
              role: "user",
              content: contentParts,
            };
            return userMessage;
          }

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

        return {
          role: message.role,
          content: message.content,
        };
      },
    );

    if (options.response_model) {
      const response = await generateText({
        model: this.model,
        messages: formattedMessages,
        output: Output.object({
          schema: options.response_model.schema,
          name: options.response_model.name,
        }),
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        topP: options.top_p,
        frequencyPenalty: options.frequency_penalty,
        presencePenalty: options.presence_penalty,
      });

      return {
        data: response.output,
        usage: toLLMUsage(response.usage),
      } as T;
    }

    const tools: Record<string, Tool> = {};
    for (const rawTool of options.tools ?? []) {
      tools[rawTool.name] = {
        description: rawTool.description,
        inputSchema: rawTool.parameters,
      } as Tool;
    }

    const response = await generateText({
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
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.top_p,
      frequencyPenalty: options.frequency_penalty,
      presencePenalty: options.presence_penalty,
    });

    return {
      data: response.text,
      usage: toLLMUsage(response.usage),
    } as T;
  }
}
