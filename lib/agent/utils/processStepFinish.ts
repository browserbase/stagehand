import { AgentAction } from "@/types/agent";
import { LogLine } from "@/types/log";
import type { AgentToolCall, AgentToolResult } from "../tools";
import { mapToolResultToActions } from "./actionHandler";

export interface StepFinishEventLike {
  finishReason?: string;
  text: string;
  toolCalls?: Array<{
    toolName: string;
    args: unknown;
  }>;
  toolResults?: Array<AgentToolResult | null>;
}

export interface ProcessedStepResult {
  actionsAppended: AgentAction[];
  collectedReasoning?: string;
  completed: boolean;
  finalMessage?: string;
}

export function processStepFinishEvent(
  event: StepFinishEventLike,
  logger: (message: LogLine) => void,
  priorReasoning: string[],
): ProcessedStepResult {
  const actions: AgentAction[] = [];
  let completed = false;
  let finalMessage: string | undefined;

  logger({
    category: "agent",
    message: `Step finished: ${event.finishReason}`,
    level: 2,
  });

  if (event.toolCalls && event.toolCalls.length > 0) {
    for (let i = 0; i < event.toolCalls.length; i++) {
      const toolCall = event.toolCalls[i];
      const typedToolCall = toolCall as AgentToolCall;

      logger({
        category: "agent",
        message: `tool call: ${typedToolCall.toolName} with args: ${JSON.stringify(typedToolCall.args)}`,
        level: 1,
      });
      if (event.text.length > 0) {
        priorReasoning.push(event.text);
        logger({
          category: "agent",
          message: `reasoning: ${event.text}`,
          level: 1,
        });
      }
      if (typedToolCall.toolName === "close") {
        completed = true;
        if (typedToolCall.args?.taskComplete) {
          const closeReasoning = typedToolCall.args.reasoning;
          const allReasoning = priorReasoning.join(" ");
          finalMessage = closeReasoning
            ? `${allReasoning} ${closeReasoning}`.trim()
            : allReasoning || "Task completed successfully";
        }
      }

      const toolResult = event.toolResults?.[i] || null;

      const mapped = mapToolResultToActions({
        toolCallName: typedToolCall.toolName,
        toolResult,
        args: typedToolCall.args || {},
        reasoning: event.text || undefined,
      });

      actions.push(...mapped);
    }
  }

  return {
    actionsAppended: actions,
    collectedReasoning: priorReasoning.join(" "),
    completed,
    finalMessage,
  };
}

export function finalizeAgentMessage(
  currentFinalMessage: string | undefined,
  priorReasoning: string[],
  resultText?: string,
): string {
  const existing = (currentFinalMessage || "").trim();
  if (existing.length > 0) return existing;
  const allReasoning = priorReasoning.join(" ").trim();
  return allReasoning || resultText || "Task completed successfully";
}
