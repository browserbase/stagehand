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
    const callsById = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";
    let trailingText = "";
    for (const message of result.messages) {
      for (const part of message.content) {
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
        const completed = status === "completed";
        const errored = status === "error";
        const unfinished = status === "pending" || status === "running";
        if (!completed && !errored && !unfinished) continue;
        const images = readImages(state.content);
        const next: NormalizedToolCall = {
          ...(typeof part.id === "string" && { id: part.id }),
          name: typeof part.name === "string" ? part.name : "tool",
          args: isRecord(state.input) ? state.input : {},
          result: completed ? state.content : unfinished ? "no tool result" : undefined,
          ok: completed,
          ...((errored || unfinished) && {
            error: errored ? readError(state.error) : "no tool result",
          }),
          ...(images.length > 0 && { images }),
          reasoning: pendingReasoning.trim() || undefined,
        };
        const existing = typeof part.id === "string" ? callsById.get(part.id) : undefined;
        if (existing) {
          if (!existing.ok && existing.error === "no tool result") Object.assign(existing, next);
          continue;
        }
        toolCalls.push(next);
        if (typeof part.id === "string") callsById.set(part.id, next);
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

function readImages(value: unknown): Array<{ bytes: Buffer; mediaType: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || item.type !== "file" || typeof item.uri !== "string") return [];
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(item.uri);
    if (!match) return [];
    return [{ bytes: Buffer.from(match[2], "base64"), mediaType: match[1] }];
  });
}

export const opencodeAdapter = new OpenCodeTrajectoryAdapter();

function attachStepObservations(toolCalls: NormalizedToolCall[], result: OpenCodeRunResult): void {
  const keyed = new Map(
    (result.stepObservations ?? [])
      .filter((observation) => observation.toolCallId)
      .map((observation) => [observation.toolCallId, observation.evidence]),
  );
  for (const call of toolCalls) {
    if (call.id && keyed.has(call.id)) call.probeEvidence = keyed.get(call.id);
  }
  const observations = (result.stepObservations ?? []).filter(
    (observation) => !observation.toolCallId,
  );
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

function readError(value: unknown): string {
  if (typeof value === "string") return value;
  const message = isRecord(value) ? value.message : undefined;
  return typeof message === "string" ? message : "OpenCode tool failed.";
}
