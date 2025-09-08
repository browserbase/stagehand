import {
  LanguageModelV1CallOptions,
  CoreMessage,
  CoreToolMessage,
  CoreAssistantMessage,
  CoreUserMessage,
  ToolResultPart,
  ToolContent,
} from "ai";
import { LLMClient } from "../llm/LLMClient";

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
): Promise<LanguageModelV1CallOptions["prompt"]> {
  const manager = new ContextManager();
  return manager.processMessages(messages, sessionId || "default");
}

export class ContextManager {
  private cache = new Map<string, CacheEntry>();
  private ttl = 3600000; // 1 hour

  // Thresholds
  private readonly CHECKPOINT_INTERVAL = 15;
  private readonly RECENT_TOOLS_TO_KEEP = 8;
  private readonly CRITICAL_CONTEXT_WINDOW = 5;
  private readonly TOKEN_LIMIT = 100000;
  private readonly AGGRESSIVE_THRESHOLD = 80000;
  private readonly SUMMARIZATION_THRESHOLD = 90000;

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

    let processedPrompt = [...promptArray] as CoreMessage[];
    let compressionLevel = 0;

    // Apply compression based on size
    if (toolCount > 7) {
      processedPrompt = this.compressOldToolResults(processedPrompt);
      compressionLevel = 1;
    }

    if (estimatedTokens > this.AGGRESSIVE_THRESHOLD) {
      processedPrompt = this.compressAggressively(processedPrompt);
      compressionLevel = 2;
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
      processedPrompt = this.compressOldToolResults(processedPrompt);
      compressionLevel = 1;
    }

    // Level 2: Checkpointing (requires LLM)
    if (
      llmClient &&
      totalToolCount >= this.CHECKPOINT_INTERVAL &&
      totalToolCount % this.CHECKPOINT_INTERVAL === 0
    ) {
      processedPrompt = await this.createCheckpoint(
        processedPrompt,
        sessionId,
        llmClient,
      );
    }

    // Level 3: Aggressive compression
    if (estimatedTokens > this.AGGRESSIVE_THRESHOLD && compressionLevel < 2) {
      processedPrompt = this.compressAggressively(processedPrompt);
      compressionLevel = 2;
    }

    // Level 4: Full summarization (requires LLM)
    if (
      llmClient &&
      estimatedTokens > this.SUMMARIZATION_THRESHOLD &&
      compressionLevel < 3
    ) {
      processedPrompt = await this.summarizeConversation(
        processedPrompt,
        sessionId,
        llmClient,
      );
      compressionLevel = 3;
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

  private compressOldToolResults(prompt: CoreMessage[]): CoreMessage[] {
    const processed = [...prompt];
    const toolPositions = new Map<string, number[]>();

    // Track tool positions
    prompt.forEach((msg, idx) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        toolMessage.content.forEach((item) => {
          if (item.toolName) {
            const positions = toolPositions.get(item.toolName) || [];
            positions.push(idx);
            toolPositions.set(item.toolName, positions);
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
            if (item.toolName) {
              // Check if this is an old tool result
              const positions = toolPositions.get(item.toolName) || [];
              const currentPos = positions.indexOf(idx);
              const isOld =
                prompt.length - idx > 7 ||
                (currentPos >= 0 && positions.length - currentPos > 2);

              if (isOld) {
                if (item.toolName === "screenshot") {
                  return {
                    type: "tool-result",
                    toolCallId: item.toolCallId,
                    toolName: item.toolName,
                    result: "Screenshot taken",
                  } as ToolResultPart;
                } else if (
                  item.toolName === "ariaTree" &&
                  item.result &&
                  typeof item.result === "string"
                ) {
                  const wordCount = item.result.split(/\s+/).length;
                  const preview = item.result.substring(0, 100) + "...";
                  return {
                    type: "tool-result",
                    toolCallId: item.toolCallId,
                    toolName: item.toolName,
                    result: `Aria tree extracted (${wordCount} words): ${preview}`,
                  } as ToolResultPart;
                }
              }
            }
            return item;
          },
        ) as ToolContent;

        return { ...toolMessage, content: processedContent } as CoreToolMessage;
      }
      return msg;
    });
  }

  private compressAggressively(prompt: CoreMessage[]): CoreMessage[] {
    return prompt.map((msg) => {
      if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        const processedContent: ToolContent = toolMessage.content.map(
          (item) => {
            if (item.toolName) {
              if (
                item.toolName === "screenshot" ||
                item.toolName === "ariaTree"
              ) {
                return {
                  type: "tool-result",
                  toolCallId: item.toolCallId,
                  toolName: item.toolName,
                  result: `[${item.toolName} result compressed]`,
                } as ToolResultPart;
              } else if (
                item.result &&
                typeof item.result === "string" &&
                item.result.length > 500
              ) {
                return {
                  type: "tool-result",
                  toolCallId: item.toolCallId,
                  toolName: item.toolName,
                  result: "[Tool result compressed - large output]",
                } as ToolResultPart;
              }
            }
            return item;
          },
        ) as ToolContent;

        return { ...toolMessage, content: processedContent } as CoreToolMessage;
      }
      return msg;
    });
  }

  private async createCheckpoint(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    // TODO: Implement checkpoint creation with LLM
    // This would use llmClient to generate summaries
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = { sessionId, llmClient }; // Parameters will be used in implementation
    return prompt;
  }

  private async summarizeConversation(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    // TODO: Implement full conversation summarization with LLM
    // This would use llmClient to generate a comprehensive summary
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = { sessionId, llmClient }; // Parameters will be used in implementation
    return prompt;
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
              }
            }
          });
        }
      } else if (msg.role === "tool") {
        const toolMessage = msg as CoreToolMessage;
        toolMessage.content.forEach((item) => {
          if (item.toolName === "screenshot") {
            tokens += 2000;
          } else if (item.toolName === "ariaTree") {
            tokens += 1000;
          } else {
            tokens += 200;
          }
        });
      }
    });
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
