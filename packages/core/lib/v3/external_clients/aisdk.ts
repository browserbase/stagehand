import {
  CoreAssistantMessage,
  ModelMessage,
  CoreSystemMessage,
  Tool,
  CoreUserMessage,
  generateObject,
  generateText,
  ImagePart,
  TextPart,
} from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { CreateChatCompletionOptions, LLMClient } from "../llm/LLMClient.js";
import { AvailableModel } from "../types/public/index.js";
import { ChatCompletion } from "openai/resources";

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV2;

  constructor({ model }: { model: LanguageModelV2 }) {
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

    if (options.response_model) {
      const response = await generateObject({
        model: this.model,
        messages: formattedMessages,
        schema: options.response_model.schema,
      });

      return {
        data: response.object,
        usage: {
          prompt_tokens: response.usage.inputTokens ?? 0,
          completion_tokens: response.usage.outputTokens ?? 0,
          reasoning_tokens: response.usage.reasoningTokens ?? 0,
          cached_input_tokens: response.usage.cachedInputTokens ?? 0,
          total_tokens: response.usage.totalTokens ?? 0,
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

    return {
      data: response.text,
      usage: {
        prompt_tokens: response.usage.inputTokens ?? 0,
        completion_tokens: response.usage.outputTokens ?? 0,
        reasoning_tokens: response.usage.reasoningTokens ?? 0,
        cached_input_tokens: response.usage.cachedInputTokens ?? 0,
        total_tokens: response.usage.totalTokens ?? 0,
      },
    } as T;
  }
}
