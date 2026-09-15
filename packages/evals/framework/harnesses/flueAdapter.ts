import type { FlueSessionEvent } from "@browserbasehq/stagehand-integrations-flue-sdk";
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface FlueRunResult {
  events: FlueSessionEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class FlueTrajectoryAdapter implements TrajectoryAdapter<FlueRunResult> {
  fromHarnessResult(result: FlueRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const openCalls = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";
    let trailingText = "";
    for (const event of result.events) {
      if (event.type === "thinking_delta") {
        pendingReasoning += event.delta;
        continue;
      }
      if (event.type === "text_delta") {
        trailingText += event.text;
        continue;
      }
      if (event.type === "tool_start") {
        const call: NormalizedToolCall = {
          name: event.toolName,
          args: isRecord(event.args) ? event.args : {},
          result: undefined,
          ok: true,
          reasoning: pendingReasoning.trim() || undefined,
        };
        toolCalls.push(call);
        openCalls.set(event.toolCallId, call);
        pendingReasoning = "";
        trailingText = "";
        continue;
      }
      if (event.type !== "tool") continue;
      const call = openCalls.get(event.toolCallId);
      if (call) {
        call.result = event.result;
        call.ok = !event.isError;
        if (event.isError) call.error = stringify(event.result) || "tool failed";
        openCalls.delete(event.toolCallId);
      } else {
        toolCalls.push({
          name: event.toolName,
          args: {},
          result: event.result,
          ok: !event.isError,
          ...(event.isError && { error: stringify(event.result) || "tool failed" }),
          reasoning: pendingReasoning.trim() || undefined,
        });
        pendingReasoning = "";
        trailingText = "";
      }
    }
    for (const call of openCalls.values()) {
      call.ok = false;
      call.error = "no tool result";
      call.result = "no tool result";
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

export const flueAdapter = new FlueTrajectoryAdapter();

function attachStepObservations(toolCalls: NormalizedToolCall[], result: FlueRunResult): void {
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

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
