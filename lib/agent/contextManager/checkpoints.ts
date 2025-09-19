import { CoreAssistantMessage, CoreMessage } from "ai";
import { isToolCallPart, messagesToText, messagesToTextDetailed } from ".";
import type { LLMClient } from "../../llm/LLMClient";
import { RECENT_MESSAGES_TO_KEEP_IN_SUMMARY } from "./constants";

export interface CheckpointPlan {
  messagesToCheckpoint: CoreMessage[];
  recentMessages: CoreMessage[];
  checkpointCount: number;
}

export function planCheckpoint(
  prompt: CoreMessage[],
  systemMsgIndex: number,
  toolCount: number,
  recentToolsToKeep: number,
  checkpointInterval: number,
): CheckpointPlan | null {
  if (toolCount < checkpointInterval) return null;

  const checkpointCount = Math.floor(toolCount / checkpointInterval);
  const toolsToKeep = toolCount - checkpointCount * checkpointInterval;
  const recentToolsStart = Math.max(
    0,
    toolCount - Math.max(recentToolsToKeep, toolsToKeep),
  );

  const messagesToCheckpoint: CoreMessage[] = [];
  const recentMessages: CoreMessage[] = [];
  let currentToolCount = 0;

  prompt.forEach((msg, idx) => {
    if (idx <= systemMsgIndex) return;
    const msgToolCount = countToolsInMessage(msg);
    if (currentToolCount < recentToolsStart) messagesToCheckpoint.push(msg);
    else recentMessages.push(msg);
    currentToolCount += msgToolCount;
  });

  if (messagesToCheckpoint.length === 0) return null;
  return { messagesToCheckpoint, recentMessages, checkpointCount };
}

export async function generateCheckpointSummary(
  messages: CoreMessage[],
  checkpointCount: number,
  llmClient: LLMClient,
): Promise<string> {
  const conversationText = messagesToText(messages);
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

export async function summarizeConversation(
  prompt: CoreMessage[],
  systemMsgIndex: number,
  llmClient: LLMClient,
): Promise<{
  summaryMessage: CoreAssistantMessage;
  recentMessages: CoreMessage[];
}> {
  const recentMessages = prompt.slice(-RECENT_MESSAGES_TO_KEEP_IN_SUMMARY);
  const summary = await generateConversationSummary(
    prompt.slice(systemMsgIndex + 1),
    llmClient,
  );
  const summaryMessage: CoreAssistantMessage = {
    role: "assistant",
    content: `[Previous Conversation Summary]\n\n${summary}\n\n[End of Summary - Continuing conversation from this point]`,
  };
  return { summaryMessage, recentMessages };
}

export async function generateConversationSummary(
  messages: CoreMessage[],
  llmClient: LLMClient,
): Promise<string> {
  const conversationText = messagesToTextDetailed(messages);
  const model = llmClient.getLanguageModel?.();
  if (!model) return "[Summary generation failed: LLM not available]";

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

export function countToolsInMessage(msg: CoreMessage): number {
  if (msg.role === "tool") return 1;
  if (msg.role === "assistant") {
    const assistantMsg = msg as CoreAssistantMessage;
    if (typeof assistantMsg.content !== "string") {
      return assistantMsg.content.filter((part) => isToolCallPart(part)).length;
    }
  }
  return 0;
}
