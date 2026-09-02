import { extractGrokBuildToolCall } from "@browserbasehq/stagehand-integrations-grok-build-sdk";
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface GrokBuildRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class GrokBuildTrajectoryAdapter implements TrajectoryAdapter<GrokBuildRunResult> {
  fromHarnessResult(result: GrokBuildRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const openCalls = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";

    for (const event of result.events) {
      if ((event.type === "thought" || event.type === "text") && typeof event.data === "string") {
        pendingReasoning = appendText(pendingReasoning, event.data);
        continue;
      }
      const view = extractGrokBuildToolCall(event);
      if (!view) continue;
      if (view.subtype === "started") {
        const call: NormalizedToolCall = {
          name: view.name ?? "tool",
          args: view.args,
          result: undefined,
          ok: true,
          reasoning: pendingReasoning.trim() || undefined,
        };
        toolCalls.push(call);
        if (view.callId) openCalls.set(view.callId, call);
        pendingReasoning = "";
        continue;
      }

      const call = view.callId ? openCalls.get(view.callId) : undefined;
      if (call) {
        call.result = normalizeToolResult(view.result);
        call.ok = view.ok;
        if (view.error) call.error = view.error;
        openCalls.delete(view.callId);
      } else {
        toolCalls.push({
          name: view.name ?? "tool",
          args: view.args,
          result: normalizeToolResult(view.result),
          ok: view.ok,
          ...(view.error && { error: view.error }),
          reasoning: pendingReasoning.trim() || undefined,
        });
        pendingReasoning = "";
      }
    }

    for (const open of openCalls.values()) {
      open.ok = false;
      open.result = "no tool result";
      open.error = "no tool result";
    }

    attachStepObservations(toolCalls, result);
    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation && { finalObservation: result.finalObservation }),
    });
  }
}

export const grokBuildAdapter = new GrokBuildTrajectoryAdapter();

function normalizeToolResult(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.content)) return result;
  const text = result.content
    .filter(isRecord)
    .map((block) => (typeof block.text === "string" ? block.text : undefined))
    .filter((part): part is string => part !== undefined);
  return text.length > 0 ? text.join("\n") : result;
}

function attachStepObservations(toolCalls: NormalizedToolCall[], result: GrokBuildRunResult): void {
  const observations = result.stepObservations ?? [];
  if (observations.length === 0) return;
  const isObservedTool =
    result.observedToolName ?? ((name: string) => name.startsWith("mcp") || name.includes("."));
  const observedCalls = toolCalls.filter((call) => isObservedTool(call.name));
  const totalObservedRuns =
    Math.max(...observations.map((observation) => observation.runIndex)) + 1;
  if (observedCalls.length !== totalObservedRuns) return;
  const byRunIndex = new Map(
    observations.map((observation) => [observation.runIndex, observation.evidence]),
  );
  observedCalls.forEach((call, ordinal) => {
    const observation = byRunIndex.get(ordinal);
    if (observation) call.probeEvidence = observation;
  });
}

function appendText(current: string, next: string): string {
  return current ? `${current}\n${next}` : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
