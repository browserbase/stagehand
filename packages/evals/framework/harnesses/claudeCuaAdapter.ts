/**
 * claudeCuaAdapter — converts a claude-cua-sdk session (Anthropic Messages API
 * loop with the Browser Use toolset) into a verifier `Trajectory`.
 *
 * Each `tool_use` event becomes one step named after the toolset member, paired
 * with its `tool_result` by tool_use id. Thinking and text blocks of the
 * assistant turn that issued the call become the step's reasoning; the text of
 * the final assistant turn (no tool calls) is the final answer. Screenshots in
 * tool results become image evidence; the runner's per-step observations are
 * attached by tool_use id.
 */
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type {
  ClaudeCuaSessionEvent,
  CuaToolResultBlock,
} from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface ClaudeCuaRunResult {
  events: ClaudeCuaSessionEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  /** Page state observed after a mutating member, keyed by tool_use id. */
  stepObservations?: Map<string, ProbeEvidence>;
}

export class ClaudeCuaTrajectoryAdapter implements TrajectoryAdapter<ClaudeCuaRunResult> {
  fromHarnessResult(result: ClaudeCuaRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const byToolUseId = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";
    let latestAssistantText: string | undefined;
    let lastImage: Buffer | undefined;

    for (const event of result.events) {
      if (event.type === "assistant") {
        const reasoningParts: string[] = [];
        const textParts: string[] = [];
        let hasToolUse = false;
        for (const block of event.content) {
          if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
            reasoningParts.push(block.thinking);
          } else if (block.type === "text" && typeof block.text === "string") {
            reasoningParts.push(block.text);
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            hasToolUse = true;
          }
        }
        if (hasToolUse) {
          pendingReasoning = reasoningParts.join("\n");
        } else {
          latestAssistantText = textParts.join("\n").trim() || latestAssistantText;
          pendingReasoning = "";
        }
        continue;
      }
      if (event.type === "tool_use") {
        const call: NormalizedToolCall = {
          name: event.name,
          args: event.input,
          result: undefined,
          ok: true,
          reasoning: pendingReasoning.trim() || undefined,
        };
        // Only the first member of a turn carries the turn's reasoning.
        pendingReasoning = "";
        toolCalls.push(call);
        byToolUseId.set(event.id, call);
        const observation = result.stepObservations?.get(event.id);
        if (observation) call.probeEvidence = observation;
        continue;
      }
      const call = byToolUseId.get(event.toolUseId);
      if (!call) continue;
      const normalized = normalizeResultContent(event.content);
      call.result = normalized.result;
      call.ok = !event.isError;
      if (event.isError) call.error = normalized.text || "tool failed";
      if (normalized.images.length > 0) {
        call.images = normalized.images;
        lastImage = normalized.images[normalized.images.length - 1]!.bytes;
      }
    }

    const finalObservation = result.finalObservation?.screenshot
      ? result.finalObservation
      : lastImage
        ? { screenshot: lastImage }
        : undefined;

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer ?? latestAssistantText,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(finalObservation && { finalObservation }),
    });
  }
}

export const claudeCuaAdapter = new ClaudeCuaTrajectoryAdapter();

function normalizeResultContent(content: string | CuaToolResultBlock[]): {
  result: unknown;
  text: string;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (typeof content === "string") return { result: content, text: content, images: [] };
  const text: string[] = [];
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  const structured: unknown[] = [];
  for (const block of content) {
    if (block.type === "text") {
      text.push(block.text);
    } else if (block.type === "image") {
      images.push({
        bytes: Buffer.from(block.source.data, "base64"),
        mediaType: block.source.media_type,
      });
      text.push("[image]");
    } else {
      structured.push(block);
    }
  }
  const joined = text.join("\n");
  return {
    result: structured.length > 0 ? { text: joined, browser_state: structured } : joined,
    text: joined,
    images,
  };
}
