import type { ModelMessage } from "ai";
import type { LLMClient } from "../../llm/LLMClient";

// Configuration constants
const TOOL_CALLS_BEFORE_COMPRESSION = 10; //eg sparse tool call compression
const RECENT_TOOL_CALLS_TO_KEEP = 5;
const SUMMARIZATION_THRESHOLD_TOKENS = 120000;
const RECENT_MESSAGES_TO_KEEP_IN_SUMMARY = 10;

// Token estimation defaults
const DEFAULT_TOKENS_PER_IMAGE = 1400;
const DEFAULT_TOKENS_PER_TOOL_CALL = 50;

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  savedChars: number;
  compressionRatio: number;
  screenshotCount: number;
  ariaTreeCount: number;
  toolCallsCompressed: number;
  summarized: boolean;
  estimatedTokens: number;
}

function isToolMessage(
  message: unknown,
): message is { role: "tool"; content: unknown[] } {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { role?: unknown }).role === "tool" &&
    Array.isArray((message as { content?: unknown }).content)
  );
}

function isScreenshotPart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { toolName?: unknown }).toolName === "screenshot"
  );
}

function isAriaTreePart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { toolName?: unknown }).toolName === "ariaTree"
  );
}

function isAssistantMessage(
  message: unknown,
): message is { role: "assistant"; content: unknown[] | string } {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { role?: unknown }).role === "assistant"
  );
}

function isToolCallPart(
  part: unknown,
): part is { type: "tool-call"; toolName: string; args: Record<string, unknown>; toolCallId: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "tool-call"
  );
}

function isToolResultPart(
  part: unknown,
): part is { type: "tool-result"; toolName: string; result: unknown; toolCallId: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "tool-result"
  );
}

function isTextContentPart(part: unknown): part is { type: "text"; text: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isImageContentPart(part: unknown): part is { type: "image"; data: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "image"
  );
}

function isUserMessage(
  message: unknown,
): message is { role: "user"; content: unknown } {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { role?: unknown }).role === "user"
  );
}

// ============================================================================
// Token Estimation
// ============================================================================

function textLengthTokens(text: string | undefined | null): number {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function estimateTokensForContent(content: unknown): number {
  if (!content) return 0;
  if (typeof content === "string") {
    return textLengthTokens(content);
  }
  if (Array.isArray(content)) {
    return content.reduce((acc: number, part: unknown) => {
      if (!part) return acc;
      if (isTextContentPart(part)) return acc + textLengthTokens(part.text);
      if (isImageContentPart(part)) return acc + DEFAULT_TOKENS_PER_IMAGE;
      if (isToolCallPart(part)) return acc + DEFAULT_TOKENS_PER_TOOL_CALL;
      if (isToolResultPart(part)) {
        const resultStr = typeof part.result === "string"
          ? part.result
          : JSON.stringify(part.result ?? "");
        return acc + textLengthTokens(resultStr);
      }
      return acc + 50; // Default for unknown parts
    }, 0);
  }
  return 50;
}

/**
 * Estimates total tokens in a message array using ~4 chars per token heuristic.
 */
export function estimateTokens(messages: ModelMessage[]): number {
  if (!messages || !Array.isArray(messages)) return 0;
  return messages.reduce((acc, msg) => {
    if (!msg) return acc;
    if (isUserMessage(msg)) {
      return acc + estimateTokensForContent(msg.content);
    }
    if (isAssistantMessage(msg)) {
      return acc + estimateTokensForContent(msg.content);
    }
    if (isToolMessage(msg)) {
      return acc + estimateTokensForContent(msg.content);
    }
    return acc;
  }, 0);
}

// ============================================================================
// Message to Text Conversion (for summarization)
// ============================================================================

function messagesToText(messages: ModelMessage[]): string {
  if (!messages || !Array.isArray(messages)) return "";
  return messages
    .filter((msg) => msg != null)
    .map((msg) => {
      if (isUserMessage(msg)) {
        const content = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as unknown[])
                .filter((p) => p != null)
                .map((p) => isTextContentPart(p) ? (p.text || "") : "[image]")
                .join(" ")
            : String(msg.content ?? "");
        return `User: ${content}`;
      }
      if (isAssistantMessage(msg)) {
        const content = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as unknown[])
                .filter((p) => p != null)
                .map((p) => {
                  if (isTextContentPart(p)) return p.text || "";
                  if (isToolCallPart(p)) return `[Called tool: ${p.toolName || "unknown"}]`;
                  if (isImageContentPart(p)) return "[image]";
                  return "";
                })
                .join(" ")
            : "";
        return `Assistant: ${content}`;
      }
      if (isToolMessage(msg) && Array.isArray(msg.content)) {
        const toolSummary = (msg.content as unknown[])
          .filter((p) => p != null)
          .map((p) => {
            if (isToolResultPart(p)) {
              const resultStr = typeof p.result === "string"
                ? p.result
                : JSON.stringify(p.result ?? "");
              const resultPreview = (resultStr || "").slice(0, 50);
              return `[${p.toolName || "unknown"} result: ${resultPreview}...]`;
            }
            return "";
          })
          .filter(Boolean)
          .join(" ");
        return `Tool: ${toolSummary}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// ============================================================================
// LLM-Powered Summarization
// ============================================================================

/**
 * Generates a comprehensive summary of the conversation using the LLM.
 */
async function generateConversationSummary(
  messages: ModelMessage[],
  llmClient: LLMClient,
): Promise<string> {
  const conversationText = messagesToText(messages);
  const model = llmClient.getLanguageModel?.();

  if (!model) {
    return "[Summary generation failed: LLM not available]";
  }

  const { text } = await llmClient.generateText({
    model,
    messages: [
      {
        role: "user",
        content: `Analyze this browser automation conversation and create a comprehensive summary that preserves all important context.

Conversation:
${conversationText}

Create a summary that:
1. Captures all key browser actions and their outcomes
2. Preserves important technical details (URLs, form data, extracted content)
3. Maintains context about what was accomplished
4. Notes the current page/state
5. Includes any pending tasks or issues
6. Summarizes data extracted or forms filled

Provide a thorough summary that will allow continuation of the automation task:`,
      },
    ],
    temperature: 0.3,
  });

  return text;
}

/**
 * Finds a safe split point that doesn't break tool call/result pairs.
 * Returns the index where we should start the "recent" messages.
 */
function findSafeSplitPoint(messages: ModelMessage[], targetRecentCount: number): number {
  if (messages.length <= targetRecentCount) {
    return 0;
  }

  let splitIndex = messages.length - targetRecentCount;

  // Check if the message at splitIndex is a tool result message
  // If so, we need to include its preceding assistant message with tool calls
  const messageAtSplit = messages[splitIndex];
  if (messageAtSplit && isToolMessage(messageAtSplit)) {
    // Find the preceding assistant message with tool calls
    // It should be the message right before
    if (splitIndex > 0) {
      splitIndex = splitIndex - 1;
    }
  }

  // Also check if the message just before splitIndex is an assistant with tool calls
  // whose results would be at splitIndex
  if (splitIndex > 0) {
    const messageBefore = messages[splitIndex - 1];
    if (messageBefore && isAssistantMessage(messageBefore) && Array.isArray(messageBefore.content)) {
      const hasToolCalls = messageBefore.content.some((part) => isToolCallPart(part));
      if (hasToolCalls) {
        // Include the assistant message with tool calls
        splitIndex = splitIndex - 1;
      }
    }
  }

  return splitIndex;
}

/**
 * Summarizes the conversation and keeps recent messages intact.
 * This is the third layer of context management, triggered when tokens > 120k.
 */
async function summarizeConversation(
  messages: ModelMessage[],
  llmClient: LLMClient,
): Promise<{ messages: ModelMessage[]; summarized: boolean }> {
  const splitIndex = findSafeSplitPoint(messages, RECENT_MESSAGES_TO_KEEP_IN_SUMMARY);

  // Keep the most recent messages intact
  const recentMessages = messages.slice(splitIndex);
  const messagesToSummarize = messages.slice(0, splitIndex);

  if (messagesToSummarize.length === 0) {
    return { messages, summarized: false };
  }

  const summary = await generateConversationSummary(messagesToSummarize, llmClient);

  const summaryMessage: ModelMessage = {
    role: "assistant",
    content: `[Previous Conversation Summary]

${summary}

[End of Summary - Continuing conversation from this point]`,
  } as ModelMessage;

  // Reconstruct: summary + recent messages
  const result: ModelMessage[] = [summaryMessage, ...recentMessages];

  return { messages: result, summarized: true };
}

// ============================================================================
// Sparse Representation System
// ============================================================================

/**
 * Generates a sparse text representation for a tool call + result pair.
 * This captures the essential information in a compact, human-readable format.
 */
function generateSparseRepresentation(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): string {
  const success = isSuccessResult(result);
  const status = success ? "✓" : "✗";
  // Safely cast result to object, defaulting to empty object if null/undefined
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  // Safely handle args
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;

  switch (toolName) {
    case "act":
      return `[act] ${status} "${truncate(String(a.action ?? ""), 50)}"${r.action ? ` → ${truncate(String(r.action), 30)}` : ""}`;

    case "ariaTree":
      return `[ariaTree] ${status} analyzed`;

    case "click":
      return `[click] ${status} "${truncate(String(a.describe ?? ""), 40)}"`;

    case "clickAndHold":
      return `[clickAndHold] ${status} "${truncate(String(a.describe ?? ""), 30)}" ${a.duration ?? 0}ms`;

    case "close":
      return `[close] ${a.taskComplete ? "✓ completed" : "✗ incomplete"}: "${truncate(String(a.reasoning ?? ""), 50)}"`;

    case "dragAndDrop":
      return `[dragAndDrop] ${status} "${truncate(String(a.describe ?? ""), 40)}"`;

    case "extract":
      return `[extract] ${status} "${truncate(String(a.instruction ?? ""), 40)}"`;

    case "fillForm": {
      const fields = Array.isArray(a.fields) ? a.fields : [];
      return `[fillForm] ${status} filled ${fields.length} fields`;
    }

    case "fillFormVision": {
      const visionFields = Array.isArray(a.fields) ? a.fields : [];
      return `[fillFormVision] ${status} filled ${visionFields.length} fields`;
    }

    case "goto":
      return `[goto] ${status} → ${truncate(String(a.url ?? r.url ?? ""), 50)}`;

    case "keys": {
      const method = a.method ?? "press";
      const keyValue = a.keys ?? a.text ?? "";
      return `[keys] ${status} ${method} "${truncate(String(keyValue), 20)}"`;
    }

    case "navback":
      return `[navback] ${status}`;

    case "screenshot":
      return `[screenshot] ${status} captured`;

    case "scroll": {
      const dir = a.direction ?? "down";
      const pct = a.percentage ?? 80;
      return `[scroll] ${status} ${dir} ${pct}%`;
    }

    case "search": {
      const data = r.data as { results?: unknown[] } | undefined;
      const resultCount = data?.results?.length ?? 0;
      return `[search] ${status} "${truncate(String(a.query ?? ""), 30)}" → ${resultCount} results`;
    }

    case "think":
      return `[think] "${truncate(String(a.reasoning ?? ""), 60)}"`;

    case "type":
      return `[type] ${status} "${truncate(String(a.text ?? ""), 25)}" into "${truncate(String(a.describe ?? ""), 25)}"`;

    case "wait":
      return `[wait] ${status} ${a.timeMs ?? 0}ms`;

    default:
      return `[${toolName}] ${status}`;
  }
}

function isSuccessResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const r = result as Record<string, unknown>;
  if ("success" in r) return r.success === true;
  if ("error" in r) return false;
  return true;
}

function truncate(str: string | undefined | null, maxLen: number): string {
  if (!str || typeof str !== "string") return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Finds tool call/result pairs in messages and returns their indices and info.
 */
interface ToolInteraction {
  assistantIndex: number;
  toolIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  toolCallId: string;
}

function findToolInteractions(messages: ModelMessage[]): ToolInteraction[] {
  const interactions: ToolInteraction[] = [];
  if (!messages || messages.length === 0) return interactions;

  const pendingCalls = new Map<string, { index: number; toolName: string; args: Record<string, unknown> }>();

  messages.forEach((message, index) => {
    if (!message) return;

    if (isAssistantMessage(message) && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isToolCallPart(part) && part.toolCallId) {
          pendingCalls.set(part.toolCallId, {
            index,
            toolName: part.toolName,
            args: part.args || {},
          });
        }
      }
    }

    if (isToolMessage(message) && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isToolResultPart(part) && part.toolCallId && pendingCalls.has(part.toolCallId)) {
          const call = pendingCalls.get(part.toolCallId)!;
          interactions.push({
            assistantIndex: call.index,
            toolIndex: index,
            toolName: call.toolName,
            args: call.args,
            result: part.result,
            toolCallId: part.toolCallId,
          });
          pendingCalls.delete(part.toolCallId);
        }
      }
    }
  });

  return interactions;
}

/**
 * Compresses old tool interactions into a sparse summary message.
 * Keeps the most recent N interactions intact.
 */
function compressToolInteractions(
  messages: ModelMessage[],
  interactions: ToolInteraction[],
): { messages: ModelMessage[]; compressedCount: number } {
  if (interactions.length < TOOL_CALLS_BEFORE_COMPRESSION) {
    return { messages, compressedCount: 0 };
  }

  const toCompress = interactions.slice(0, -RECENT_TOOL_CALLS_TO_KEEP);
  if (toCompress.length === 0) {
    return { messages, compressedCount: 0 };
  }

  // Generate sparse representations for old interactions
  const sparseLines = toCompress.map((interaction) =>
    generateSparseRepresentation(interaction.toolName, interaction.args, interaction.result)
  );

  // Create summary message
  const summaryText = `[Previous actions - ${toCompress.length} steps]\n${sparseLines.map((l) => `• ${l}`).join("\n")}`;

  // Find indices to remove (both assistant tool-call parts and tool-result messages)
  const assistantIndicesToModify = new Set(toCompress.map((i) => i.assistantIndex));
  const toolIndicesToRemove = new Set(toCompress.map((i) => i.toolIndex));
  const toolCallIdsToRemove = new Set(toCompress.map((i) => i.toolCallId));

  // Build new message array
  const newMessages: ModelMessage[] = [];
  let insertedSummary = false;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    // For tool result messages that contain compressed results, filter out only the compressed results
    // (Don't skip the entire message - it may contain results for non-compressed tool calls)
    if (toolIndicesToRemove.has(i) && isToolMessage(message) && Array.isArray(message.content)) {
      const filteredContent = message.content.filter((part) => {
        if (isToolResultPart(part)) {
          return !toolCallIdsToRemove.has(part.toolCallId);
        }
        return true;
      });

      // Only keep the message if there are remaining tool results
      if (filteredContent.length > 0) {
        newMessages.push({
          ...message,
          content: filteredContent,
        } as ModelMessage);
      }
      continue;
    }

    // For assistant messages, filter out compressed tool calls
    if (isAssistantMessage(message) && assistantIndicesToModify.has(i) && Array.isArray(message.content)) {
      const filteredContent = message.content.filter((part) => {
        if (isToolCallPart(part)) {
          return !toolCallIdsToRemove.has(part.toolCallId);
        }
        return true;
      });

      // If there's remaining content, keep the message
      if (filteredContent.length > 0) {
        // Insert summary before first modified assistant message
        if (!insertedSummary) {
          newMessages.push({
            role: "assistant",
            content: summaryText,
          } as ModelMessage);
          insertedSummary = true;
        }
        newMessages.push({
          ...message,
          content: filteredContent,
        } as ModelMessage);
      } else if (!insertedSummary) {
        // Replace empty assistant message with summary
        newMessages.push({
          role: "assistant",
          content: summaryText,
        } as ModelMessage);
        insertedSummary = true;
      }
      continue;
    }

    newMessages.push(message);
  }

  // If we never inserted the summary (edge case), prepend it after the first user message
  if (!insertedSummary && toCompress.length > 0) {
    const firstUserIdx = newMessages.findIndex((m) => (m as { role: string }).role === "user");
    if (firstUserIdx >= 0) {
      newMessages.splice(firstUserIdx + 1, 0, {
        role: "assistant",
        content: summaryText,
      } as ModelMessage);
    }
  }

  return { messages: newMessages, compressedCount: toCompress.length };
}

export interface CompressMessagesOptions {
  /**
   * Enable sparse representation of old tool calls.
   * @default true
   */
  sparseToolCalls?: boolean;
  /**
   * Enable LLM-powered summarization when context exceeds 120k tokens.
   * @default true
   */
  summarization?: boolean;
}

/**
 * Compresses messages by:
 * 1. Replacing old screenshots/aria trees with placeholders (keeps 2 most recent screenshots, 1 aria tree)
 * 2. Consolidating old tool calls into sparse text summaries (after 10+ tool calls, keeps 5 most recent)
 * 3. LLM-powered summarization when tokens exceed 120k (requires llmClient)
 *
 * Steps 2 and 3 can be disabled via options.
 */
export async function compressMessages(
  messages: ModelMessage[],
  llmClient?: LLMClient,
  options?: CompressMessagesOptions,
): Promise<{
  messages: ModelMessage[];
  stats: CompressionStats;
}> {
  const enableSparseToolCalls = options?.sparseToolCalls !== false;
  const enableSummarization = options?.summarization !== false;
  // Safety check: return early if messages is undefined or empty
  if (!messages || !Array.isArray(messages)) {
    return {
      messages: messages || [],
      stats: {
        originalSize: 0,
        compressedSize: 0,
        savedChars: 0,
        compressionRatio: 0,
        screenshotCount: 0,
        ariaTreeCount: 0,
        toolCallsCompressed: 0,
        summarized: false,
        estimatedTokens: 0,
      },
    };
  }

  if (messages.length === 0) {
    return {
      messages: [],
      stats: {
        originalSize: 0,
        compressedSize: 0,
        savedChars: 0,
        compressionRatio: 0,
        screenshotCount: 0,
        ariaTreeCount: 0,
        toolCallsCompressed: 0,
        summarized: false,
        estimatedTokens: 0,
      },
    };
  }

  // Filter out any undefined/null messages
  const validMessages = messages.filter((m): m is ModelMessage => m != null);
  if (validMessages.length === 0) {
    return {
      messages: [],
      stats: {
        originalSize: 0,
        compressedSize: 0,
        savedChars: 0,
        compressionRatio: 0,
        screenshotCount: 0,
        ariaTreeCount: 0,
        toolCallsCompressed: 0,
        summarized: false,
        estimatedTokens: 0,
      },
    };
  }

  // Calculate original content size
  const originalContentSize = JSON.stringify(validMessages).length;

  // Step 1: Compress old screenshots and aria trees
  const screenshotIndices = findToolIndices(validMessages, "screenshot");
  const ariaTreeIndices = findToolIndices(validMessages, "ariaTree");

  let processedMessages = validMessages.map(
    (message: ModelMessage, index: number) => {
      if (!message) return message;

      if (isToolMessage(message) && Array.isArray(message.content)) {
        const content = message.content;
        if (content.some((part) => isScreenshotPart(part))) {
          const shouldCompress = shouldCompressScreenshot(
            index,
            screenshotIndices,
          );
          if (shouldCompress) {
            return compressScreenshotMessage(message) as ModelMessage;
          }
        }
        if (content.some((part) => isAriaTreePart(part))) {
          const shouldCompress = shouldCompressAriaTree(index, ariaTreeIndices);
          if (shouldCompress) {
            return compressAriaTreeMessage(message) as ModelMessage;
          }
        }
      }

      return message;
    },
  );

  // Step 2: Compress old tool interactions into sparse summaries (if enabled)
  let compressedCount = 0;
  if (enableSparseToolCalls) {
    const interactions = findToolInteractions(processedMessages);
    const { messages: sparseMessages, compressedCount: count } = compressToolInteractions(
      processedMessages,
      interactions,
    );
    processedMessages = sparseMessages;
    compressedCount = count;
  }

  // Step 3: LLM-powered summarization if tokens > 120k threshold (if enabled)
  let summarized = false;
  let currentTokens = estimateTokens(processedMessages);

  if (enableSummarization && llmClient && currentTokens > SUMMARIZATION_THRESHOLD_TOKENS) {
    try {
      const { messages: summarizedMessages, summarized: didSummarize } =
        await summarizeConversation(processedMessages, llmClient);
      if (didSummarize) {
        processedMessages = summarizedMessages;
        summarized = true;
        currentTokens = estimateTokens(processedMessages);
      }
    } catch {
      // If summarization fails, continue with what we have
    }
  }

  const compressedContentSize = JSON.stringify(processedMessages).length;
  const stats = calculateCompressionStats(
    originalContentSize,
    compressedContentSize,
    screenshotIndices.length,
    ariaTreeIndices.length,
    compressedCount,
    summarized,
    currentTokens,
  );

  return {
    messages: processedMessages,
    stats,
  };
}

function findToolIndices(
  prompt: unknown[],
  toolName: "screenshot" | "ariaTree",
): number[] {
  const indices: number[] = [];
  if (!prompt || !Array.isArray(prompt)) return indices;

  prompt.forEach((message, index) => {
    if (!message) return;
    if (isToolMessage(message) && Array.isArray(message.content)) {
      const hasMatch = message.content.some((part) =>
        toolName === "screenshot"
          ? isScreenshotPart(part)
          : isAriaTreePart(part),
      );
      if (hasMatch) {
        indices.push(index);
      }
    }
  });

  return indices;
}

function shouldCompressScreenshot(
  index: number,
  screenshotIndices: number[],
): boolean {
  if (!screenshotIndices || screenshotIndices.length === 0) return false;
  const isNewestScreenshot = index === Math.max(...screenshotIndices);
  const isSecondNewestScreenshot =
    screenshotIndices.length > 1 &&
    index === [...screenshotIndices].sort((a, b) => b - a)[1];

  return !isNewestScreenshot && !isSecondNewestScreenshot;
}

function shouldCompressAriaTree(
  index: number,
  ariaTreeIndices: number[],
): boolean {
  if (!ariaTreeIndices || ariaTreeIndices.length === 0) return false;
  const isNewestAriaTree = index === Math.max(...ariaTreeIndices);
  // Only keep the most recent ARIA tree
  return !isNewestAriaTree;
}

function compressScreenshotMessage(message: {
  role: "tool";
  content: unknown[];
}): { role: "tool"; content: unknown[] } {
  if (!message.content || !Array.isArray(message.content)) {
    return message;
  }
  const updatedContent = message.content.map((part) => {
    if (isScreenshotPart(part)) {
      return {
        ...(part as object),
        result: [
          {
            type: "text",
            text: "screenshot taken",
          },
        ],
      } as unknown;
    }
    return part;
  });

  return {
    ...message,
    content: updatedContent,
  } as { role: "tool"; content: unknown[] };
}

function compressAriaTreeMessage(message: {
  role: "tool";
  content: unknown[];
}): { role: "tool"; content: unknown[] } {
  if (!message.content || !Array.isArray(message.content)) {
    return message;
  }
  const updatedContent = message.content.map((part) => {
    if (isAriaTreePart(part)) {
      return {
        ...(part as object),
        result: [
          {
            type: "text",
            text: "ARIA tree extracted for context of page elements",
          },
        ],
      } as unknown;
    }
    return part;
  });

  return {
    ...message,
    content: updatedContent,
  } as { role: "tool"; content: unknown[] };
}

function calculateCompressionStats(
  originalSize: number,
  compressedSize: number,
  screenshotCount: number,
  ariaTreeCount: number,
  toolCallsCompressed: number,
  summarized: boolean,
  estimatedTokens: number,
): CompressionStats {
  const savedChars = originalSize - compressedSize;
  const compressionRatio =
    originalSize > 0
      ? ((originalSize - compressedSize) / originalSize) * 100
      : 0;

  return {
    originalSize,
    compressedSize,
    savedChars,
    compressionRatio,
    screenshotCount,
    ariaTreeCount,
    toolCallsCompressed,
    summarized,
    estimatedTokens,
  };
}
