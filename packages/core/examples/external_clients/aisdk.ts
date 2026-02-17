import {
  ModelMessage,
  Tool,
  generateText,
  ImagePart,
  Output,
  TextPart,
} from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import {
  CreateChatCompletionOptions,
  LLMClient,
} from "../../lib/v3/llm/LLMClient";
import { AvailableModel } from "../../lib/v3/types/public";
import { ChatCompletion } from "openai/resources";

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV3;

  constructor({ model }: { model: LanguageModelV3 }) {
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

    if (options.response_model) {
      const response = await generateText({
        model: this.model,
        messages: formattedMessages,
        output: Output.object({
          schema: options.response_model.schema,
        }),
      });

      const usage = response.usage;
      return {
        data: response.output,
        usage: {
          prompt_tokens: usage.inputTokens ?? 0,
          completion_tokens: usage.outputTokens ?? 0,
          reasoning_tokens:
            usage.outputTokenDetails?.reasoningTokens ??
            usage.reasoningTokens ??
            0,
          cached_input_tokens:
            usage.inputTokenDetails?.cacheReadTokens ??
            usage.cachedInputTokens ??
            0,
          total_tokens: usage.totalTokens ?? 0,
        },
      } as T;
    }

    const tools: Record<string, Tool> = {};

    for (const rawTool of options.tools) {
      tools[rawTool.name] = {
        description: rawTool.description,
        inputSchema: rawTool.parameters,
      } as Tool;
    }

    const response = await generateText({
      model: this.model,
      messages: formattedMessages,
      tools,
    });

    const usage = response.usage;
    return {
      data: response.text,
      usage: {
        prompt_tokens: usage.inputTokens ?? 0,
        completion_tokens: usage.outputTokens ?? 0,
        reasoning_tokens:
          usage.outputTokenDetails?.reasoningTokens ??
          usage.reasoningTokens ??
          0,
        cached_input_tokens:
          usage.inputTokenDetails?.cacheReadTokens ??
          usage.cachedInputTokens ??
          0,
        total_tokens: usage.totalTokens ?? 0,
      },
    } as T;
  }
}
