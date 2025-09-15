import {
  LanguageModelV1CallOptions,
  CoreMessage,
  CoreToolMessage,
  CoreAssistantMessage,
  CoreUserMessage,
  ToolResultPart,
  ToolContent,
  ToolCallPart,
} from "ai";
import { LLMClient } from "../llm/LLMClient";
import { LogLine } from "../../types/log";

interface ProcessedState {
  processedPrompt: LanguageModelV1CallOptions["prompt"];
  lastProcessedIndex: number;
  checkpointCount: number;
  totalToolCount: number;
  compressionLevel: number;
}

interface CacheEntry {
  state: ProcessedState;
  timestamp: number;
}

// Export the compressMessages function for direct use
export async function compressMessages(
  messages: LanguageModelV1CallOptions["prompt"],
  sessionId?: string,
  logger?: (message: LogLine) => void,
): Promise<LanguageModelV1CallOptions["prompt"]> {
  const manager = new ContextManager(logger);
  return manager.processMessages(messages, sessionId || "default");
}

export class ContextManager {
  private cache = new Map<string, CacheEntry>();
  private ttl = 3600000; // 1 hour
  private logger?: (message: LogLine) => void;

  // Thresholds
  private readonly CHECKPOINT_INTERVAL = 15;
  private readonly RECENT_TOOLS_TO_KEEP = 10;
  private readonly AGGRESSIVE_THRESHOLD = 100000;
  private readonly SUMMARIZATION_THRESHOLD = 120000;

  constructor(logger?: (message: LogLine) => void) {
    this.logger = logger;
  }

  private log(message: string, level: 0 | 1 | 2 = 1) {
    if (this.logger) {
      this.logger({
        category: "context",
        message,
        level,
      });
    }
  }

  /**
   * Process messages intelligently, maintaining compression state across calls
   */
  async processMessages(
    prompt: LanguageModelV1CallOptions["prompt"],
    sessionId: string,
    llmClient?: LLMClient,
  ): Promise<LanguageModelV1CallOptions["prompt"]> {
    // Clean up old cache entries
    this.cleanup();

    // Get previous state if it exists
    const cachedEntry = this.cache.get(sessionId);
    const previousState = cachedEntry?.state;

    if (!previousState) {
      // First call - process all messages
      return this.processInitialPrompt(prompt, sessionId);
    }

    // Subsequent call - handle incremental updates
    return this.processIncrementalPrompt(
      prompt,
      sessionId,
      previousState,
      llmClient,
    );
  }

  private async processInitialPrompt(
    prompt: LanguageModelV1CallOptions["prompt"],
    sessionId: string,
  ): Promise<LanguageModelV1CallOptions["prompt"]> {
    const promptArray = Array.isArray(prompt) ? prompt : [];
    const toolCount = this.countTools(promptArray as CoreMessage[]);
    const estimatedTokens = this.estimateTokens(promptArray as CoreMessage[]);

    this.log(
      `Initial prompt analysis: ${promptArray.length} messages, ${toolCount} tools, ~${estimatedTokens} tokens`,
      2,
    );

    let processedPrompt = [...promptArray] as CoreMessage[];
    let compressionLevel = 0;

    // Apply compression based on size
    if (toolCount > 7) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      processedPrompt = this.compressOldToolResults(processedPrompt);
      const afterSize = JSON.stringify(processedPrompt).length;
      compressionLevel = 1;

      this.log(
        `Basic compression applied: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}% reduction)`,
        2,
      );
    }

    if (estimatedTokens > this.AGGRESSIVE_THRESHOLD) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      processedPrompt = this.compressAggressively(processedPrompt);
      const afterSize = JSON.stringify(processedPrompt).length;
      compressionLevel = 2;

      this.log(
        `Aggressive compression applied: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}% reduction)`,
        1,
      );
    }

    // Save state
    const state: ProcessedState = {
      processedPrompt: processedPrompt as LanguageModelV1CallOptions["prompt"],
      lastProcessedIndex: promptArray.length,
      checkpointCount: 0,
      totalToolCount: toolCount,
      compressionLevel,
    };

    this.cache.set(sessionId, {
      state,
      timestamp: Date.now(),
    });

    return processedPrompt as LanguageModelV1CallOptions["prompt"];
  }

  private async processIncrementalPrompt(
    prompt: LanguageModelV1CallOptions["prompt"],
    sessionId: string,
    previousState: ProcessedState,
    llmClient?: LLMClient,
  ): Promise<LanguageModelV1CallOptions["prompt"]> {
    const promptArray = Array.isArray(prompt) ? prompt : [];
    const previousPromptArray = Array.isArray(previousState.processedPrompt)
      ? previousState.processedPrompt
      : [];

    // Identify new messages (those added since last processing)
    const newMessages = promptArray.slice(previousState.lastProcessedIndex);

    // Start with previously processed messages
    let processedPrompt = [...previousPromptArray] as CoreMessage[];

    // Add new messages
    processedPrompt = processedPrompt.concat(newMessages as CoreMessage[]);

    // Count total tools
    const totalToolCount =
      previousState.totalToolCount +
      this.countTools(newMessages as CoreMessage[]);
    const estimatedTokens = this.estimateTokens(processedPrompt);

    // Apply progressive compression
    let compressionLevel = previousState.compressionLevel;

    // Level 1: Basic compression
    if (totalToolCount > 7 && compressionLevel < 1) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      processedPrompt = this.compressOldToolResults(processedPrompt);
      const afterSize = JSON.stringify(processedPrompt).length;
      compressionLevel = 1;

      this.log(
        `Basic compression: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}% reduction)`,
        2,
      );
    }

    // Level 2: Checkpointing (requires LLM)
    if (
      llmClient &&
      totalToolCount >= this.CHECKPOINT_INTERVAL &&
      totalToolCount % this.CHECKPOINT_INTERVAL === 0
    ) {
      const beforeCount = processedPrompt.length;
      processedPrompt = await this.createCheckpoint(
        processedPrompt,
        sessionId,
        llmClient,
      );
      const afterCount = processedPrompt.length;

      this.log(
        `📍 Checkpoint created: ${beforeCount} → ${afterCount} messages (${totalToolCount} tools processed)`,
        1,
      );
    }

    // Level 3: Aggressive compression
    if (estimatedTokens > this.AGGRESSIVE_THRESHOLD && compressionLevel < 2) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      processedPrompt = this.compressAggressively(processedPrompt);
      const afterSize = JSON.stringify(processedPrompt).length;
      compressionLevel = 2;

      this.log(
        `⚡ Aggressive compression: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}% reduction)`,
        1,
      );
    }

    // Level 4: Full summarization (requires LLM)
    if (
      llmClient &&
      estimatedTokens > this.SUMMARIZATION_THRESHOLD &&
      compressionLevel < 3
    ) {
      const beforeCount = processedPrompt.length;
      processedPrompt = await this.summarizeConversation(
        processedPrompt,
        sessionId,
        llmClient,
      );
      const afterCount = processedPrompt.length;
      compressionLevel = 3;

      this.log(
        `🔥 FULL SUMMARIZATION: ${beforeCount} → ${afterCount} messages (exceeded ${this.SUMMARIZATION_THRESHOLD} tokens)`,
        0,
      );
    }

    // Update state
    const newState: ProcessedState = {
      processedPrompt: processedPrompt as LanguageModelV1CallOptions["prompt"],
      lastProcessedIndex: promptArray.length,
      checkpointCount: Math.floor(totalToolCount / this.CHECKPOINT_INTERVAL),
      totalToolCount,
      compressionLevel,
    };

    this.cache.set(sessionId, {
      state: newState,
      timestamp: Date.now(),
    });

    return processedPrompt as LanguageModelV1CallOptions["prompt"];
  }

  private isImageContentPart(
    item: unknown,
  ): item is { type: "image"; data: string; mimeType: string } {
    return (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      (item as { type?: unknown }).type === "image"
    );
  }

  private isTextContentPart(
    item: unknown,
  ): item is { type: "text"; text: string } {
    return (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      (item as { type?: unknown }).type === "text" &&
      "text" in (item as object) &&
      typeof (item as { text?: unknown }).text === "string"
    );
  }

  private isAccessibilityTreeTextPart(
    item: unknown,
  ): item is { type: "text"; text: string } {
    return (
      this.isTextContentPart(item) &&
      (item as { text: string }).text.startsWith("Accessibility Tree:")
    );
  }

  private compressOldToolResults(prompt: CoreMessage[]): CoreMessage[] {
    const processed = [...prompt];
    const toolPositions = new Map<string, number[]>();
    let compressedCount = 0;
    let imageCompressedCount = 0;
    let ariaTextCompressedCount = 0;

    // Track tool positions
    prompt.forEach((msg, idx) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        toolMessage.content.forEach((item) => {
          if (
            "toolName" in item &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            const toolName = (item as { toolName: string }).toolName;
            const positions = toolPositions.get(toolName) || [];
            positions.push(idx);
            toolPositions.set(toolName, positions);
          }
        });
      }
    });

    // Compress old tool results
    return processed.map((msg, idx) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        const processedContent: ToolContent = toolMessage.content.map(
          (item) => {
            if (
              "toolName" in item &&
              typeof (item as { toolName?: unknown }).toolName === "string"
            ) {
              // Check if this is an old tool result
              const toolName = (item as { toolName: string }).toolName;
              const positions = toolPositions.get(toolName) || [];
              const currentPos = positions.indexOf(idx);
              const isOld =
                prompt.length - idx > 7 ||
                (currentPos >= 0 && positions.length - currentPos > 2);

              if (isOld) {
                compressedCount++;
                if (toolName === "screenshot") {
                  return {
                    type: "tool-result",
                    toolCallId: (item as ToolResultPart).toolCallId,
                    toolName,
                    result: "Screenshot taken",
                  } as ToolResultPart;
                } else if (
                  toolName === "ariaTree" &&
                  (item as ToolResultPart).result &&
                  typeof (item as ToolResultPart).result === "string"
                ) {
                  const text = (item as ToolResultPart).result as string;
                  const wordCount = text.split(/\s+/).length;
                  const preview = text.substring(0, 100) + "...";
                  return {
                    type: "tool-result",
                    toolCallId: (item as ToolResultPart).toolCallId,
                    toolName,
                    result: `Aria tree extracted (${wordCount} words): ${preview}`,
                  } as ToolResultPart;
                }
              }
            }

            // Also compress raw image parts emitted via experimental_toToolResultContent
            if (this.isImageContentPart(item)) {
              imageCompressedCount++;
              return {
                type: "text",
                text: "[screenshot]",
              } as unknown as ToolContent[number];
            }

            // Compress very large Accessibility Tree textual parts
            if (this.isAccessibilityTreeTextPart(item)) {
              const textVal = (item as { type: "text"; text: string }).text;
              if (textVal.length > 4000) {
                ariaTextCompressedCount++;
                return {
                  type: "text",
                  text: textVal.substring(0, 3500) + "... [truncated]",
                } as unknown as ToolContent[number];
              }
            }

            return item;
          },
        ) as ToolContent;

        return { ...toolMessage, content: processedContent } as CoreToolMessage;
      }
      return msg;
    });

    if (
      compressedCount > 0 ||
      imageCompressedCount > 0 ||
      ariaTextCompressedCount > 0
    ) {
      this.log(
        `Compressed ${compressedCount} old tool results; ${imageCompressedCount} image parts; ${ariaTextCompressedCount} accessibility text parts`,
        2,
      );
    }

    return processed;
  }

  private compressAggressively(prompt: CoreMessage[]): CoreMessage[] {
    let compressedCount = 0;
    let largeOutputCount = 0;
    let imageCompressedCount = 0;
    let ariaTextCompressedCount = 0;

    const result = prompt.map((msg) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        const processedContent: ToolContent = toolMessage.content.map(
          (item) => {
            if (
              "toolName" in item &&
              typeof (item as { toolName?: unknown }).toolName === "string"
            ) {
              const toolName = (item as { toolName: string }).toolName;
              if (toolName === "screenshot" || toolName === "ariaTree") {
                compressedCount++;
                return {
                  type: "tool-result",
                  toolCallId: (item as ToolResultPart).toolCallId,
                  toolName,
                  result: `[${toolName} result compressed]`,
                } as ToolResultPart;
              } else if (
                (item as ToolResultPart).result !== undefined &&
                typeof (item as ToolResultPart).result === "string" &&
                ((item as ToolResultPart).result as string).length > 500
              ) {
                largeOutputCount++;
                return {
                  type: "tool-result",
                  toolCallId: (item as ToolResultPart).toolCallId,
                  toolName,
                  result: "[Tool result compressed - large output]",
                } as ToolResultPart;
              }
            }

            // Aggressively compress raw image parts
            if (this.isImageContentPart(item)) {
              imageCompressedCount++;
              return {
                type: "text",
                text: "[screenshot]",
              } as unknown as ToolContent[number];
            }

            // Aggressively compress large Accessibility Tree textual parts
            if (this.isAccessibilityTreeTextPart(item)) {
              const textVal = (item as { type: "text"; text: string }).text;
              if (textVal.length > 1000) {
                ariaTextCompressedCount++;
                return {
                  type: "text",
                  text: textVal.substring(0, 800) + "... [truncated]",
                } as unknown as ToolContent[number];
              }
            }

            return item;
          },
        ) as ToolContent;

        return { ...toolMessage, content: processedContent } as CoreToolMessage;
      }
      return msg;
    });

    this.log(
      `Aggressive compression: ${compressedCount} screenshot/ariaTree + ${largeOutputCount} large outputs + ${imageCompressedCount} image parts + ${ariaTextCompressedCount} accessibility text parts compressed`,
      2,
    );

    return result;
  }

  private async createCheckpoint(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    try {
      const toolCount = this.countTools(prompt);
      if (toolCount < this.CHECKPOINT_INTERVAL) {
        return prompt;
      }

      // Find the system message
      const systemMsgIndex = prompt.findIndex((msg) => msg.role === "system");
      const systemMessage = systemMsgIndex >= 0 ? prompt[systemMsgIndex] : null;

      // Calculate checkpoint ranges
      const checkpointCount = Math.floor(toolCount / this.CHECKPOINT_INTERVAL);
      const toolsToKeep =
        toolCount - checkpointCount * this.CHECKPOINT_INTERVAL;
      const recentToolsStart = Math.max(
        0,
        toolCount - Math.max(this.RECENT_TOOLS_TO_KEEP, toolsToKeep),
      );

      // Extract messages for checkpointing
      const messagesToCheckpoint: CoreMessage[] = [];
      const recentMessages: CoreMessage[] = [];
      let currentToolCount = 0;

      prompt.forEach((msg, idx) => {
        if (idx <= systemMsgIndex) return; // Skip system message

        const msgToolCount = this.countToolsInMessage(msg);

        if (currentToolCount < recentToolsStart) {
          messagesToCheckpoint.push(msg);
        } else {
          recentMessages.push(msg);
        }

        currentToolCount += msgToolCount;
      });

      if (messagesToCheckpoint.length === 0) {
        return prompt;
      }

      // Create checkpoint summary using LLM
      const checkpointText = await this.generateCheckpointSummary(
        messagesToCheckpoint,
        checkpointCount,
        llmClient,
      );

      // Create checkpoint message
      const checkpointMessage: CoreAssistantMessage = {
        role: "assistant",
        content: checkpointText,
      };

      // Reconstruct messages
      const result: CoreMessage[] = [];
      if (systemMessage) {
        result.push(systemMessage);
      }
      result.push(checkpointMessage);
      result.push(...recentMessages);

      this.log(
        `Checkpoint created: ${messagesToCheckpoint.length} messages → 1 checkpoint + ${recentMessages.length} recent messages`,
        1,
      );

      return result;
    } catch (error) {
      this.log(
        `Checkpoint creation failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
      return prompt;
    }
  }

  private countToolsInMessage(msg: CoreMessage): number {
    if (msg.role === "tool") {
      return 1;
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as CoreAssistantMessage;
      if (typeof assistantMsg.content !== "string") {
        return assistantMsg.content.filter(
          (part) => "type" in part && part.type === "tool-call",
        ).length;
      }
    }
    return 0;
  }

  private async generateCheckpointSummary(
    messages: CoreMessage[],
    checkpointCount: number,
    llmClient: LLMClient,
  ): Promise<string> {
    // Convert messages to readable format
    const conversationText = this.messagesToText(messages);

    // Use the LLM client to generate summary
    const model = llmClient.getLanguageModel?.();
    if (!model) {
      return `[Checkpoint Summary - ${checkpointCount} checkpoints]\n[Summary generation failed: LLM not available]`;
    }

    const { text } = await llmClient.generateText({
      model,
      messages: [
        {
          role: "user",
          content: `Create a concise checkpoint summary of this browser automation conversation segment.

Focus on:
1. What browser actions were performed
2. What was accomplished
3. Current state/context
4. Any errors or issues

Conversation segment:
${conversationText}

Provide a brief summary (max 200 words) that preserves essential context for continuing the automation task:`,
        },
      ],
      maxTokens: 300,
      temperature: 0.3,
    });

    return `[Checkpoint Summary - ${checkpointCount} checkpoints]\n${text}`;
  }

  private messagesToText(messages: CoreMessage[]): string {
    return messages
      .map((msg) => {
        if (msg.role === "user") {
          const userMsg = msg as CoreUserMessage;
          const content =
            typeof userMsg.content === "string"
              ? userMsg.content
              : userMsg.content
                  .map((p) => (p.type === "text" ? p.text : "[image]"))
                  .join(" ");
          return `User: ${content}`;
        } else if (msg.role === "assistant") {
          const assistantMsg = msg as CoreAssistantMessage;
          const content =
            typeof assistantMsg.content === "string"
              ? assistantMsg.content
              : assistantMsg.content
                  .map((p) => {
                    if ("type" in p) {
                      if (p.type === "text") return p.text;
                      if (p.type === "tool-call") {
                        return `[Called tool: ${(p as ToolCallPart).toolName}]`;
                      }
                    }
                    return "";
                  })
                  .join(" ");
          return `Assistant: ${content}`;
        } else if (msg.role === "tool") {
          const toolMsg = msg as CoreToolMessage;
          const toolSummary = toolMsg.content
            .map(
              (t) =>
                `[${t.toolName} result${
                  t.result &&
                  typeof t.result === "string" &&
                  t.result.length > 100
                    ? ": " + t.result.substring(0, 100) + "..."
                    : ""
                }]`,
            )
            .join(" ");
          return `Tool: ${toolSummary}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  private async summarizeConversation(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    try {
      // Find system message
      const systemMsgIndex = prompt.findIndex((msg) => msg.role === "system");
      const systemMessage = systemMsgIndex >= 0 ? prompt[systemMsgIndex] : null;

      // Keep only the last few messages for continuity
      const recentMessages = prompt.slice(-10);

      // Generate comprehensive summary
      const summary = await this.generateConversationSummary(
        prompt.slice(systemMsgIndex + 1), // Exclude system message from summary
        llmClient,
      );

      // Create summary message
      const summaryMessage: CoreAssistantMessage = {
        role: "assistant",
        content: `[Previous Conversation Summary]\n\n${summary}\n\n[End of Summary - Continuing conversation from this point]`,
      };

      // Reconstruct minimal message list
      const result: CoreMessage[] = [];
      if (systemMessage) {
        result.push(systemMessage);
      }
      result.push(summaryMessage);

      // Add recent messages but skip system message duplicates
      recentMessages.forEach((msg) => {
        if (msg.role !== "system") {
          result.push(msg);
        }
      });

      // Store summary in cache for potential reuse
      this.cache.set(`${sessionId}:summary`, {
        state: {
          processedPrompt: result as LanguageModelV1CallOptions["prompt"],
          lastProcessedIndex: prompt.length,
          checkpointCount: 0,
          totalToolCount: 0,
          compressionLevel: 3,
        },
        timestamp: Date.now(),
      });

      this.log(
        `🎯 Full conversation summary created: ${prompt.length} → ${result.length} messages`,
        1,
      );

      return result;
    } catch (error) {
      this.log(
        `Conversation summarization failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
      return prompt;
    }
  }

  private async generateConversationSummary(
    messages: CoreMessage[],
    llmClient: LLMClient,
  ): Promise<string> {
    // Convert messages to readable format
    const conversationText = this.messagesToTextDetailed(messages);

    // Use the LLM client to generate summary
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
2. Preserves important technical details
3. Maintains context about what was accomplished
4. Notes the current page/state
5. Includes any pending tasks or issues
6. Summarizes data extracted or forms filled

Provide a thorough summary that will allow continuation of the automation task:`,
        },
      ],
      maxTokens: 500,
      temperature: 0.3,
    });

    return text;
  }

  private messagesToTextDetailed(messages: CoreMessage[]): string {
    return messages
      .map((msg) => {
        if (msg.role === "user") {
          const userMsg = msg as CoreUserMessage;
          const content =
            typeof userMsg.content === "string"
              ? userMsg.content
              : userMsg.content
                  .map((p) => (p.type === "text" ? p.text : "[image]"))
                  .join(" ");
          return `User: ${content}`;
        } else if (msg.role === "assistant") {
          const assistantMsg = msg as CoreAssistantMessage;
          const content =
            typeof assistantMsg.content === "string"
              ? assistantMsg.content
              : assistantMsg.content
                  .map((p) => {
                    if ("type" in p) {
                      if (p.type === "text") return p.text;
                      if (p.type === "tool-call") {
                        return `[Called tool: ${(p as ToolCallPart).toolName}]`;
                      }
                    }
                    return "";
                  })
                  .join(" ");
          return `Assistant: ${content}`;
        } else if (msg.role === "tool") {
          const toolMsg = msg as CoreToolMessage;
          const toolSummary = toolMsg.content
            .map((t) => {
              let result = `[${t.toolName} result`;
              if (t.toolName === "screenshot") {
                result += ": Screenshot taken";
              } else if (
                t.toolName === "ariaTree" &&
                t.result &&
                typeof t.result === "string"
              ) {
                const preview = t.result.substring(0, 100);
                result += `: ${preview}...`;
              } else if (
                t.result &&
                typeof t.result === "string" &&
                t.result.length > 0
              ) {
                const preview = t.result.substring(0, 50);
                result += `: ${preview}${t.result.length > 50 ? "..." : ""}`;
              }
              result += "]";
              return result;
            })
            .join(" ");
          return `Tool: ${toolSummary}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  private countTools(prompt: CoreMessage[]): number {
    let count = 0;
    prompt.forEach((msg) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        count += toolMessage.content.length;
      } else if (msg.role === "assistant") {
        const assistantMessage = msg as CoreAssistantMessage;
        if (typeof assistantMessage.content !== "string") {
          assistantMessage.content.forEach((part) => {
            if ("type" in part && part.type === "tool-call") {
              count++;
            }
          });
        }
      }
    });
    return count;
  }

  private estimateTokens(prompt: CoreMessage[]): number {
    let tokens = 0;
    const stats = {
      screenshots: 0,
      ariaTrees: 0,
      images: 0,
      toolCalls: 0,
    };

    prompt.forEach((msg) => {
      if (msg.role === "user") {
        const userMessage = msg as CoreUserMessage;
        if (typeof userMessage.content === "string") {
          tokens += Math.ceil(userMessage.content.length / 4);
        } else {
          // Handle array content (text + images)
          userMessage.content.forEach((part) => {
            if (part.type === "text") {
              tokens += Math.ceil(part.text.length / 4);
            } else if (part.type === "image") {
              tokens += 2000; // Image tokens
              stats.images++;
            }
          });
        }
      } else if (msg.role === "assistant") {
        const assistantMessage = msg as CoreAssistantMessage;
        if (typeof assistantMessage.content === "string") {
          tokens += Math.ceil(assistantMessage.content.length / 4);
        } else {
          assistantMessage.content.forEach((part) => {
            if ("type" in part) {
              if (part.type === "text") {
                tokens += Math.ceil(part.text.length / 4);
              } else if (part.type === "tool-call") {
                tokens += 50; // Tool call overhead
                stats.toolCalls++;
              }
            }
          });
        }
      } else if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        toolMessage.content.forEach((item) => {
          if (item.toolName === "screenshot") {
            tokens += 2000;
            stats.screenshots++;
          } else if (item.toolName === "ariaTree") {
            tokens += 1000;
            stats.ariaTrees++;
          } else {
            tokens += 200;
          }
        });
      }
    });

    this.log(
      `Token estimate: ${tokens} (${stats.screenshots} screenshots, ${stats.ariaTrees} ariaTrees, ${stats.images} images, ${stats.toolCalls} tool calls)`,
      2,
    );

    return tokens;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear session data after execution
   */
  clearSession(sessionId: string) {
    this.cache.delete(sessionId);
  }
}
