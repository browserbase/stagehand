import {
  CoreAssistantMessage,
  CoreMessage,
  CoreToolMessage,
  CoreUserMessage,
} from "ai";
import {
  isImageContentPart,
  isTextContentPart,
  isToolCallPart,
  toolResultSummaryLabel,
} from ".";
import { IMAGE_TEXT_PLACEHOLDER } from "./constants";

export function messagesToText(messages: CoreMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === "user") {
        const userMsg = msg as CoreUserMessage;
        const content =
          typeof userMsg.content === "string"
            ? userMsg.content
            : userMsg.content
                .map((p) =>
                  isTextContentPart(p) ? p.text : IMAGE_TEXT_PLACEHOLDER,
                )
                .join(" ");
        return `User: ${content}`;
      } else if (msg.role === "assistant") {
        const assistantMsg = msg as CoreAssistantMessage;
        const content =
          typeof assistantMsg.content === "string"
            ? assistantMsg.content
            : assistantMsg.content
                .map((p) => {
                  if (isTextContentPart(p)) return p.text;
                  if (isToolCallPart(p)) return `[Called tool: ${p.toolName}]`;
                  if (isImageContentPart(p)) return "[image]";
                  return "";
                })
                .join(" ");
        return `Assistant: ${content}`;
      } else if (msg.role === "tool") {
        const toolMsg = msg as CoreToolMessage;
        const toolSummary = toolMsg.content
          .map(toolResultSummaryLabel)
          .join(" ");
        return `Tool: ${toolSummary}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// After cleanup, both functions became identical, so just alias the detailed version
export const messagesToTextDetailed = messagesToText;
