import type { OpenCodeMessage } from "@browserbasehq/stagehand-integrations-opencode-sdk";
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface OpenCodeRunResult {
  messages: OpenCodeMessage[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class OpenCodeTrajectoryAdapter implements TrajectoryAdapter<OpenCodeRunResult> {
  fromHarnessResult(result: OpenCodeRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    let pendingReasoning = "";
    let trailingText = "";
    for (const message of result.messages) {
      for (const part of message.parts) {
        if (part.type === "reasoning" && typeof part.text === "string") {
          pendingReasoning = appendText(pendingReasoning, part.text);
          continue;
        }
        if (part.type === "text" && typeof part.text === "string") {
          trailingText = appendText(trailingText, part.text);
          continue;
        }
        if (part.type !== "tool") continue;
        const state = isRecord(part.state) ? part.state : {};
        const status = typeof state.status === "string" ? state.status : "pending";
        toolCalls.push({
          name: typeof part.tool === "string" ? part.tool : "tool",
          args: isRecord(state.input) ? state.input : {},
          result: status === "completed" ? state.output : undefined,
          ok: status === "completed",
          ...(status === "error" && typeof state.error === "string" && { error: state.error }),
          reasoning: pendingReasoning.trim() || undefined,
        });
        pendingReasoning = "";
        trailingText = "";
      }
    }
    attachStepObservations(toolCalls, result);
    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer ?? (trailingText.trim() || undefined),
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation && { finalObservation: result.finalObservation }),
    });
  }
}

export const opencodeAdapter = new OpenCodeTrajectoryAdapter();

function attachStepObservations(toolCalls: NormalizedToolCall[], result: OpenCodeRunResult): void {
  const observations = result.stepObservations ?? [];
  if (observations.length === 0) return;
  const observed = toolCalls.filter((call) => result.observedToolName?.(call.name) ?? true);
  const totalRuns = Math.max(...observations.map((entry) => entry.runIndex)) + 1;
  if (observed.length !== totalRuns) return;
  const byIndex = new Map(observations.map((entry) => [entry.runIndex, entry.evidence]));
  observed.forEach((call, index) => {
    const evidence = byIndex.get(index);
    if (evidence) call.probeEvidence = evidence;
  });
}

function appendText(current: string, next: string): string {
  return current ? `${current}\n${next}` : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
