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
          ...(view.callId && { id: view.callId }),
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
        call.images = toolResultImages(view.result);
        call.ok = view.ok;
        if (view.error) call.error = view.error;
        openCalls.delete(view.callId);
      } else {
        toolCalls.push({
          ...(view.callId && { id: view.callId }),
          name: view.name ?? "tool",
          args: view.args,
          result: normalizeToolResult(view.result),
          images: toolResultImages(view.result),
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

function unwrapToolResult(result: unknown): unknown {
  if (isRecord(result) && result.type === "MCP" && isRecord(result.output)) {
    return result.output.OkayOutput ?? result.output.Error ?? result.output;
  }
  return result;
}

function normalizeToolResult(value: unknown): unknown {
  const result = unwrapToolResult(value);
  if (typeof result === "string")
    return result.replace(/data:(image\/[^;\s]+);base64,([A-Za-z0-9+/=]+)/gu, "[image]");
  if (!isRecord(result)) return result;
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (!Array.isArray(result.content)) return result;
  const text = result.content
    .filter(isRecord)
    .map((block) => (typeof block.text === "string" ? block.text : undefined))
    .filter((part): part is string => part !== undefined);
  return text.length > 0 ? text.join("\n") : result;
}

function toolResultImages(value: unknown): NormalizedToolCall["images"] {
  const result = unwrapToolResult(value);
  if (typeof result === "string") {
    const images = [...result.matchAll(/data:(image\/[^;\s]+);base64,([A-Za-z0-9+/=]+)/gu)].map(
      (match) => ({ bytes: Buffer.from(match[2], "base64"), mediaType: match[1] }),
    );
    return images.length ? images : undefined;
  }
  const blocks = isRecord(result) ? result.content : result;
  if (!Array.isArray(blocks)) return undefined;
  const images = blocks.flatMap((block) => {
    if (!isRecord(block)) return [];
    const image = block.type === "content" && isRecord(block.content) ? block.content : block;
    return image.type === "image" &&
      typeof image.data === "string" &&
      typeof image.mimeType === "string"
      ? [{ bytes: Buffer.from(image.data, "base64"), mediaType: image.mimeType }]
      : [];
  });
  return images.length ? images : undefined;
}

function attachStepObservations(toolCalls: NormalizedToolCall[], result: GrokBuildRunResult): void {
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
  const isObservedTool =
    result.observedToolName ?? ((name: string) => name.startsWith("mcp") || name.includes("."));
  const observedCalls = toolCalls.filter((call) => isObservedTool(call.name));
  const totalObservedRuns =
    Math.max(...observations.map((observation) => observation.runIndex)) + 1;
  // A failed final capture leaves earlier observations valid at their original indices.
  if (totalObservedRuns > observedCalls.length) return;
  const byRunIndex = new Map(
    observations.map((observation) => [observation.runIndex, observation.evidence]),
  );
  observedCalls.forEach((call, ordinal) => {
    if (call.probeEvidence) return;
    const observation = byRunIndex.get(ordinal);
    if (observation) call.probeEvidence = observation;
  });
}

function appendText(current: string, next: string): string {
  return current + next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
