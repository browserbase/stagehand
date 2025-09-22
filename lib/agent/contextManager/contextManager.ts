import {
  LanguageModelV1CallOptions,
  CoreMessage,
  CoreAssistantMessage,
} from "ai";
import {
  compressToolResults,
  countTools,
  estimateTokens,
  generateCheckpointSummary,
  planCheckpoint,
  summarizeConversation as summarizeConversationUtil,
} from ".";

import {
  CHECKPOINT_INTERVAL,
  RECENT_TOOLS_TO_KEEP,
  SUMMARIZATION_THRESHOLD,
} from "./constants";

import { LLMClient } from "../../llm/LLMClient";
import { LogLine } from "../../../types/log";

type PromptInput = LanguageModelV1CallOptions["prompt"];

interface ProcessedState {
  processedPrompt: PromptInput;
  lastProcessedIndex: number;
  checkpointCount: number;
  totalToolCount: number;
  compressionLevel: number;
}

interface CacheEntry {
  state: ProcessedState;
  timestamp: number;
}

export async function compressMessages(
  messages: PromptInput,
  sessionId?: string,
  logger?: (message: LogLine) => void,
): Promise<PromptInput> {
  const manager = new ContextManager(logger);
  return manager.processMessages(messages, sessionId || "default");
}

export class ContextManager {
  private cache = new Map<string, CacheEntry>();
  private ttl = 3600000; // 1 hour
  private logger?: (message: LogLine) => void;

  // Thresholds moved to centralized constants

  constructor(logger?: (message: LogLine) => void) {
    this.logger = logger;
  }

  async processMessages(
    prompt: PromptInput,
    sessionId: string,
    llmClient?: LLMClient,
  ): Promise<PromptInput> {
    this.cleanup();

    const cachedEntry = this.cache.get(sessionId);
    const previousState = cachedEntry?.state;

    if (!previousState) {
      return this.processInitialPrompt(prompt, sessionId);
    }

    return this.processIncrementalPrompt(
      prompt,
      sessionId,
      previousState,
      llmClient,
    );
  }

  private async processInitialPrompt(
    prompt: PromptInput,
    sessionId: string,
  ): Promise<PromptInput> {
    const promptArray = this.toCoreMessages(prompt);
    const toolCount = countTools(promptArray);
    const estimatedTokens = estimateTokens(promptArray);

    this.logger?.({
      category: "context",
      message: `Initial prompt analysis: ${promptArray.length} messages, ${toolCount} tools, ~${estimatedTokens} tokens`,
      level: 2,
    });

    let processedPrompt = [...promptArray];
    let compressionLevel = 0;

    if (toolCount > 7) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      processedPrompt = compressToolResults(processedPrompt, (message, level) =>
        this.logger?.({
          category: "context",
          message,
          level,
        }),
      );
      const afterSize = JSON.stringify(processedPrompt).length;
      compressionLevel = 1;

      this.logger?.({
        category: "context",
        message: `Basic compression applied: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}% reduction)`,
        level: 2,
      });
    }

    const state: ProcessedState = {
      processedPrompt: processedPrompt as PromptInput,
      lastProcessedIndex: promptArray.length,
      checkpointCount: 0,
      totalToolCount: toolCount,
      compressionLevel,
    };

    this.setCache(sessionId, state);

    return processedPrompt as PromptInput;
  }

  private async processIncrementalPrompt(
    prompt: PromptInput,
    sessionId: string,
    previousState: ProcessedState,
    llmClient?: LLMClient,
  ): Promise<PromptInput> {
    const promptArray = this.toCoreMessages(prompt);
    const previousPromptArray = Array.isArray(previousState.processedPrompt)
      ? (previousState.processedPrompt as CoreMessage[])
      : [];

    const newMessages = promptArray.slice(previousState.lastProcessedIndex);

    let processedPrompt = [...previousPromptArray];

    processedPrompt = processedPrompt.concat(newMessages as CoreMessage[]);

    const totalToolCount =
      previousState.totalToolCount + countTools(newMessages as CoreMessage[]);
    let estimatedTokensNow = estimateTokens(processedPrompt);

    let compressionLevel = previousState.compressionLevel;

    // Level 1: Basic compression (idempotent; re-apply to cover new tool results)
    if (totalToolCount > 7) {
      const beforeSize = JSON.stringify(processedPrompt).length;
      const beforeTokens = estimatedTokensNow;
      processedPrompt = compressToolResults(processedPrompt, (message, level) =>
        this.logger?.({
          category: "context",
          message,
          level,
        }),
      );
      const afterSize = JSON.stringify(processedPrompt).length;
      estimatedTokensNow = estimateTokens(processedPrompt);
      if (afterSize !== beforeSize || estimatedTokensNow !== beforeTokens) {
        if (compressionLevel < 1) {
          compressionLevel = 1;
        }
        const tokenReductionPct = Math.round(
          (1 - estimatedTokensNow / Math.max(1, beforeTokens)) * 100,
        );
        this.logger?.({
          category: "context",
          message: `Basic compression: ${beforeSize} → ${afterSize} chars (${Math.round((1 - afterSize / beforeSize) * 100)}%); tokens ~${beforeTokens} → ~${estimatedTokensNow} (${tokenReductionPct}%)`,
          level: 2,
        });
      }
    }

    if (llmClient && this.shouldCreateCheckpoint(totalToolCount)) {
      const beforeCount = processedPrompt.length;
      const beforeTokens = estimatedTokensNow;
      processedPrompt = await this.createCheckpoint(
        processedPrompt,
        sessionId,
        llmClient,
      );
      const afterCount = processedPrompt.length;
      estimatedTokensNow = estimateTokens(processedPrompt);

      const tokenReductionPct = Math.round(
        (1 - estimatedTokensNow / Math.max(1, beforeTokens)) * 100,
      );
      this.logger?.({
        category: "context",
        message: `Checkpoint created: ${beforeCount} → ${afterCount} messages (${totalToolCount} tools processed)`,
        level: 2,
      });
      this.logger?.({
        category: "context",
        message: `Checkpoint optimization: tokens ~${beforeTokens} → ~${estimatedTokensNow} (${tokenReductionPct}%)`,
        level: 2,
      });
    }

    const shouldSummarizeByTokens =
      estimatedTokensNow > SUMMARIZATION_THRESHOLD;

    if (llmClient && shouldSummarizeByTokens && compressionLevel < 2) {
      const beforeCount = processedPrompt.length;
      processedPrompt = await this.summarizeAndTruncateConversation(
        processedPrompt,
        sessionId,
        llmClient,
      );
      const afterCount = processedPrompt.length;
      compressionLevel = 2;

      this.logger?.({
        category: "context",
        message: `FULL SUMMARIZATION: ${beforeCount} → ${afterCount} messages (exceeded ${SUMMARIZATION_THRESHOLD} tokens)`,
        level: 2,
      });
    } else if (llmClient && compressionLevel < 2) {
      this.logger?.({
        category: "context",
        message: `Skip summarization: tokens ~${estimatedTokensNow} ≤ threshold ${SUMMARIZATION_THRESHOLD}`,
        level: 2,
      });
    }

    const newState: ProcessedState = {
      processedPrompt: processedPrompt as PromptInput,
      lastProcessedIndex: promptArray.length,
      checkpointCount: Math.floor(totalToolCount / CHECKPOINT_INTERVAL),
      totalToolCount,
      compressionLevel,
    };

    this.setCache(sessionId, newState);

    return processedPrompt as PromptInput;
  }

  private async createCheckpoint(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    try {
      const toolCount = countTools(prompt);
      const { index: systemMsgIndex, systemMessage } =
        this.getSystemMessageInfo(prompt);
      const plan = planCheckpoint(
        prompt,
        systemMsgIndex,
        toolCount,
        RECENT_TOOLS_TO_KEEP,
        CHECKPOINT_INTERVAL,
      );
      if (!plan) return prompt;

      const { messagesToCheckpoint, recentMessages, checkpointCount } = plan;
      const checkpointText = await generateCheckpointSummary(
        messagesToCheckpoint,
        checkpointCount,
        llmClient,
      );

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

      this.logger?.({
        category: "context",
        message: `Checkpoint created: ${messagesToCheckpoint.length} messages → 1 checkpoint + ${recentMessages.length} recent messages`,
        level: 2,
      });

      return result;
    } catch (error) {
      this.logger?.({
        category: "context",
        message: `Checkpoint creation failed: ${error instanceof Error ? error.message : String(error)}`,
        level: 2,
      });
      return prompt;
    }
  }

  private async summarizeAndTruncateConversation(
    prompt: CoreMessage[],
    sessionId: string,
    llmClient: LLMClient,
  ): Promise<CoreMessage[]> {
    try {
      // Find system message
      const { index: systemMsgIndex, systemMessage } =
        this.getSystemMessageInfo(prompt);

      // Pre-summarization metrics
      const beforeTokenEstimate = estimateTokens(prompt);
      const beforeCharSize = JSON.stringify(prompt).length;
      const beforeMessageCount = prompt.length;

      const { summaryMessage, recentMessages } =
        await summarizeConversationUtil(prompt, systemMsgIndex, llmClient);

      const result: CoreMessage[] = [];
      if (systemMessage) {
        result.push(systemMessage);
      }
      result.push(summaryMessage);

      recentMessages.forEach((msg) => {
        if (msg.role !== "system") {
          result.push(msg);
        }
      });

      // Post-summarization metrics
      const afterTokenEstimate = estimateTokens(result);
      const afterCharSize = JSON.stringify(result).length;
      const afterMessageCount = result.length;

      const tokenReductionPct = Math.round(
        (1 - afterTokenEstimate / Math.max(1, beforeTokenEstimate)) * 100,
      );
      const charReductionPct = Math.round(
        (1 - afterCharSize / Math.max(1, beforeCharSize)) * 100,
      );

      this.logger?.({
        category: "context",
        message: `Summarization optimization: messages ${beforeMessageCount} → ${afterMessageCount}; tokens ~${beforeTokenEstimate} → ~${afterTokenEstimate} (${tokenReductionPct}%); chars ${beforeCharSize} → ${afterCharSize} (${charReductionPct}%); recent kept ${recentMessages.length}${systemMessage ? " + system" : ""}`,
        level: 2,
      });

      this.cache.set(`${sessionId}:summary`, {
        state: {
          processedPrompt: result as PromptInput,
          lastProcessedIndex: prompt.length,
          checkpointCount: 0,
          totalToolCount: 0,
          compressionLevel: 2,
        },
        timestamp: Date.now(),
      });

      this.logger?.({
        category: "context",
        message: `Full conversation summary created: ${prompt.length} → ${result.length} messages`,
        level: 2,
      });

      return result;
    } catch (error) {
      this.logger?.({
        category: "context",
        message: `Conversation summarization failed: ${error instanceof Error ? error.message : String(error)}`,
        level: 2,
      });
      return prompt;
    }
  }

  private getSystemMessageInfo(messages: CoreMessage[]): {
    index: number;
    systemMessage: CoreMessage | null;
  } {
    const index = messages.findIndex((msg) => msg.role === "system");
    return {
      index,
      systemMessage: index >= 0 ? messages[index] : null,
    };
  }

  private toCoreMessages(prompt: PromptInput): CoreMessage[] {
    return Array.isArray(prompt) ? (prompt as CoreMessage[]) : [];
  }

  private shouldCreateCheckpoint(totalToolCount: number): boolean {
    return (
      totalToolCount >= CHECKPOINT_INTERVAL &&
      totalToolCount % CHECKPOINT_INTERVAL === 0
    );
  }

  private setCache(sessionId: string, state: ProcessedState): void {
    this.cache.set(sessionId, {
      state,
      timestamp: Date.now(),
    });
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  clearSession(sessionId: string) {
    this.cache.delete(sessionId);
  }
}
