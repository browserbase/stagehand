import type {
  AssistantModelMessage,
  LanguageModelUsage,
  ModelMessage,
  SystemModelMessage,
  UserModelMessage,
} from "ai";
import type { ChatMessage, LLMUsage } from "./LLMClient.js";

export function formatAiSdkMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return {
        role: message.role,
        content: message.content,
      };
    }

    if (message.role === "system") {
      const systemMessage: SystemModelMessage = {
        role: "system",
        content: message.content
          .map((content) => ("text" in content ? content.text ?? "" : ""))
          .join("\n"),
      };
      return systemMessage;
    }

    const contentParts = message.content.map((content) => {
      if ("image_url" in content) {
        return {
          type: "image" as const,
          image: content.image_url?.url ?? "",
        };
      }

      return {
        type: "text" as const,
        text: content.text,
      };
    });

    if (message.role === "user") {
      const userMessage: UserModelMessage = {
        role: "user",
        content: contentParts,
      };
      return userMessage;
    }

    const assistantMessage: AssistantModelMessage = {
      role: "assistant",
      content: contentParts.map((part) => ({
        type: "text" as const,
        text: part.type === "image" ? "[Image]" : part.text,
      })),
    };
    return assistantMessage;
  });
}

export function getReasoningTokens(
  usage?:
    | Pick<LanguageModelUsage, "outputTokenDetails" | "reasoningTokens">
    | null,
): number {
  return usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0;
}

export function getCachedInputTokens(
  usage?:
    | Pick<LanguageModelUsage, "inputTokenDetails" | "cachedInputTokens">
    | null,
): number {
  return usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0;
}

export function toLLMUsage(usage?: LanguageModelUsage): LLMUsage {
  return {
    prompt_tokens: usage?.inputTokens ?? 0,
    completion_tokens: usage?.outputTokens ?? 0,
    reasoning_tokens: getReasoningTokens(usage),
    cached_input_tokens: getCachedInputTokens(usage),
    total_tokens: usage?.totalTokens ?? 0,
  };
}
