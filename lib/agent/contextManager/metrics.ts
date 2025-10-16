import { CoreMessage } from "ai";
import {
  isImageContentPart,
  isTextContentPart,
  textLengthTokens,
  estimateTokensForToolContent,
  isToolCallPart,
} from ".";
import {
  DEFAULT_TOKENS_PER_IMAGE,
  DEFAULT_TOKENS_PER_TOOL_CALL,
} from "./constants";

export function countTools(prompt: CoreMessage[]): number {
  let count = 0;
  prompt.forEach((msg) => {
    if (msg.role === "tool") {
      const toolMessage = msg;
      count += toolMessage.content.length;
    } else if (msg.role === "assistant") {
      const assistantMessage = msg;
      if (typeof assistantMessage.content !== "string") {
        assistantMessage.content.forEach((part) => {
          if (isToolCallPart(part)) count++;
        });
      }
    }
  });
  return count;
}

export function estimateTokens(prompt: CoreMessage[]): number {
  let tokens = 0;
  prompt.forEach((msg) => {
    if (msg.role === "user") {
      const user = msg;
      if (typeof user.content === "string") {
        tokens += textLengthTokens(user.content);
      } else {
        user.content.forEach((part) => {
          if (isTextContentPart(part)) tokens += textLengthTokens(part.text);
          else if (isImageContentPart(part)) tokens += DEFAULT_TOKENS_PER_IMAGE;
        });
      }
    } else if (msg.role === "assistant") {
      const assistantMessage = msg;
      if (typeof assistantMessage.content === "string") {
        tokens += textLengthTokens(assistantMessage.content);
      } else {
        assistantMessage.content.forEach((part) => {
          if (isTextContentPart(part)) {
            tokens += textLengthTokens(part.text);
          } else if (isToolCallPart(part)) {
            tokens += DEFAULT_TOKENS_PER_TOOL_CALL;
          }
        });
      }
    } else if (msg.role === "tool") {
      const toolMessage = msg;
      toolMessage.content.forEach((item) => {
        tokens += estimateTokensForToolContent(item);
      });
    }
  });
  return tokens;
}
