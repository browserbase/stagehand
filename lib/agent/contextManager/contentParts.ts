import type { AgentToolResult } from "../tools";
import {
  DEFAULT_TOKENS_FOR_UNKNOWN_TOOL_CONTENT,
  DEFAULT_TOKENS_PER_IMAGE,
  DEFAULT_TOKENS_PER_TOOL_CALL,
  GENERIC_RESULT_PREVIEW_CHARS,
  ARIA_TREE_PREVIEW_CHARS,
} from "./constants";

// Helper to convert any result to string consistently
export function getResultAsString(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

// Helper to safely check object properties
function hasProperty<T extends string>(
  obj: unknown,
  prop: T,
): obj is Record<T, unknown> {
  return typeof obj === "object" && obj !== null && prop in obj;
}
export function isImageContentPart(
  item: unknown,
): item is { type: "image"; data: string; mimeType: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "image"
  );
}

export function isTextContentPart(
  item: unknown,
): item is { type: "text"; text: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string"
  );
}

export function isToolCallPart(part: unknown): part is {
  type: "tool-call";
} {
  return hasProperty(part, "type") && part.type === "tool-call";
}

export function textLengthTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sumTokensFromTextParts(
  parts: Array<{ type: "text"; text: string }>,
): number {
  return parts.reduce((acc, p) => acc + textLengthTokens(p.text), 0);
}

export function isToolResultContentPart(
  item: unknown,
): item is AgentToolResult {
  return hasProperty(item, "type") && item.type === "tool-result";
}

export function estimateTokensForToolContent(item: unknown): number {
  if (isImageContentPart(item)) return DEFAULT_TOKENS_PER_IMAGE;
  if (!isToolResultContentPart(item))
    return DEFAULT_TOKENS_FOR_UNKNOWN_TOOL_CONTENT;

  const toolResult = item as AgentToolResult;
  if (toolResult.toolName === "screenshot") {
    // If compression replaced screenshot tool-result with a small string, count it as text
    const maybeString = (toolResult as unknown as { result?: unknown }).result;
    if (typeof maybeString === "string") {
      return textLengthTokens(maybeString);
    }
    // Otherwise treat as a small tool result rather than an image
    return DEFAULT_TOKENS_PER_TOOL_CALL;
  }

  if (toolResult.toolName === "ariaTree") {
    if (toolResult.result.success && toolResult.result.content) {
      return textLengthTokens(toolResult.result.content);
    }
    return DEFAULT_TOKENS_FOR_UNKNOWN_TOOL_CONTENT;
  }

  // For all other tools, estimate based on result content
  const resultStr = getResultAsString(toolResult.result);
  return textLengthTokens(resultStr);
}

export function toolResultSummaryLabel(t: AgentToolResult): string {
  if (t.toolName === "screenshot") {
    return `[screenshot result: Screenshot taken]`;
  }

  if (t.toolName === "ariaTree") {
    if (t.result.success && t.result.content) {
      return `[ariaTree result: ${previewText(
        t.result.content,
        ARIA_TREE_PREVIEW_CHARS,
      )}]`;
    } else if (!t.result.success && t.result.error) {
      return `[ariaTree error: ${t.result.error}]`;
    }
    return `[ariaTree result: Aria tree retrieved]`;
  }

  // Handle all other tools
  const resultStr = getResultAsString(t.result);
  if (resultStr.length > 0) {
    return `[${t.toolName} result: ${previewText(
      resultStr,
      GENERIC_RESULT_PREVIEW_CHARS,
    )}]`;
  }
  return `[${t.toolName} result]`;
}

export function compressToolResultContent(
  toolResult: AgentToolResult,
  options?: { truncateTextOver?: number },
): AgentToolResult {
  const limit = options?.truncateTextOver ?? 4000;

  if (toolResult.toolName === "screenshot") {
    return toolResult;
  }

  const resultStr = getResultAsString(toolResult.result);

  if (resultStr.length > limit) {
    if (toolResult.toolName === "ariaTree" && toolResult.result.content) {
      return {
        ...toolResult,
        result: {
          ...toolResult.result,
          content: "Aria tree retrieved - truncated",
        },
      } as AgentToolResult;
    }
    return { ...toolResult, result: "Truncated" } as unknown as AgentToolResult;
  }

  return toolResult;
}

function previewText(text: string, maxChars: number): string {
  const preview = text.substring(0, maxChars);
  return `${preview}${text.length > maxChars ? "..." : ""}`;
}
