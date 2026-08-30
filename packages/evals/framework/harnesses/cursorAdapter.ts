/**
 * cursorAdapter — converts Cursor CLI stream-json events into a `Trajectory`
 * the verifier can consume.
 *
 * Mapping:
 *   - assistant text preceding a tool call becomes that call's reasoning;
 *     trailing assistant text is the final-answer fallback.
 *   - tool_call started/completed pairs by call_id. Completed-only events are
 *     retained, because Cursor may omit a started event in captured output.
 *   - documented result.success/error envelopes become normalized tool output.
 *     The currently undocumented MCP shape is parsed defensively by the shared
 *     cursor-sdk helper.
 *   - result.result is the preferred stream final-answer fallback.
 */
import { extractCursorToolCall } from "@browserbasehq/stagehand-integrations-cursor-sdk";
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface CursorRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class CursorTrajectoryAdapter implements TrajectoryAdapter<CursorRunResult> {
  fromHarnessResult(result: CursorRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const openCalls = new Map<string, NormalizedToolCall>();
    const trailingTextParts: string[] = [];
    let pendingReasoning = "";
    let resultMessageText: string | undefined;

    for (const event of result.events) {
      const type = String(event.type ?? "");
      if (type === "assistant") {
        for (const text of extractAssistantText(event)) {
          pendingReasoning = appendText(pendingReasoning, text);
          trailingTextParts.push(text);
        }
        continue;
      }
      if (type === "result") {
        if (typeof event.result === "string" && event.result.trim()) {
          resultMessageText = event.result;
        }
        continue;
      }

      const view = extractCursorToolCall(event);
      if (!view) continue;
      if (view.subtype === "started") {
        const call = normalizeToolCall(view, pendingReasoning);
        toolCalls.push(call);
        if (view.callId) openCalls.set(view.callId, call);
        pendingReasoning = "";
        trailingTextParts.length = 0;
        continue;
      }
      if (view.subtype === "completed") {
        const open = view.callId ? openCalls.get(view.callId) : undefined;
        if (open) {
          applyCompletedToolCall(open, view);
          openCalls.delete(view.callId);
        } else {
          toolCalls.push(normalizeToolCall(view, pendingReasoning));
          pendingReasoning = "";
          trailingTextParts.length = 0;
        }
      }
    }

    // A 'started' call with no 'completed' envelope (stream aborted, CLI
    // killed mid-call) must not read as a successful step — mirror the
    // deepagents adapter's unmatched-call handling.
    for (const open of openCalls.values()) {
      open.ok = false;
      open.result = "no tool result";
      open.error = "no tool result";
    }

    attachStepObservations(toolCalls, result);
    const trailing = trailingTextParts.join("\n").trim();
    const finalAnswer =
      result.finalAnswer ?? resultMessageText ?? (trailing.length > 0 ? trailing : undefined);
    const finalObservation = resolveFinalObservation(result.finalObservation, toolCalls);

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(finalObservation && { finalObservation }),
    });
  }
}

export const cursorAdapter = new CursorTrajectoryAdapter();

type CursorToolView = NonNullable<ReturnType<typeof extractCursorToolCall>>;

function normalizeToolCall(view: CursorToolView, reasoning: string): NormalizedToolCall {
  const content = normalizeToolResult(view.result);
  return {
    name: view.name,
    args: view.args,
    result: content.result,
    ok: view.ok,
    ...(view.error && { error: view.error }),
    reasoning: reasoning.trim() || undefined,
    ...(content.images.length && { images: content.images }),
  };
}

function applyCompletedToolCall(call: NormalizedToolCall, view: CursorToolView): void {
  const content = normalizeToolResult(view.result);
  call.name = view.name;
  call.args = view.args;
  call.result = content.result;
  call.ok = view.ok;
  if (view.error) call.error = view.error;
  else delete call.error;
  if (content.images.length) call.images = content.images;
}

function normalizeToolResult(result: unknown): {
  result: unknown;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return { result, images: [] };
  }
  const parts: string[] = [];
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  for (const block of result.content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image") {
      const image = decodeImageBlock(block);
      if (image) {
        images.push(image);
        parts.push("[image]");
      }
    } else if (typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return { result: parts.join("\n"), images };
}

function decodeImageBlock(
  block: Record<string, unknown>,
): { bytes: Buffer; mediaType: string } | undefined {
  const source = isRecord(block.source) ? block.source : undefined;
  const data =
    source?.type === "base64" && typeof source.data === "string"
      ? source.data
      : typeof block.data === "string"
        ? block.data
        : undefined;
  if (!data) return undefined;
  const mediaType =
    typeof source?.media_type === "string"
      ? source.media_type
      : typeof block.mimeType === "string"
        ? block.mimeType
        : "image/png";
  try {
    return { bytes: Buffer.from(data, "base64"), mediaType };
  } catch {
    return undefined;
  }
}

function attachStepObservations(toolCalls: NormalizedToolCall[], result: CursorRunResult): void {
  const observations = result.stepObservations ?? [];
  if (observations.length === 0) return;
  const isObservedTool =
    result.observedToolName ?? ((name: string) => name.startsWith("mcp") || name.includes("."));
  const observedCalls = toolCalls.filter((call) => isObservedTool(call.name));
  const totalObservedRuns =
    Math.max(...observations.map((observation) => observation.runIndex)) + 1;
  if (observedCalls.length !== totalObservedRuns) return;
  const observationsByRunIndex = new Map(
    observations.map((observation) => [observation.runIndex, observation.evidence]),
  );
  observedCalls.forEach((call, ordinal) => {
    const observation = observationsByRunIndex.get(ordinal);
    if (observation) call.probeEvidence = observation;
  });
}

function resolveFinalObservation(
  finalObservation: ProbeEvidence | undefined,
  toolCalls: NormalizedToolCall[],
): ProbeEvidence | undefined {
  if (finalObservation?.screenshot) return finalObservation;
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const images = toolCalls[index].images;
    const image = images?.[images.length - 1];
    if (image) return { screenshot: image.bytes };
  }
  return undefined;
}

function extractAssistantText(event: Record<string, unknown>): string[] {
  const message = isRecord(event.message) ? event.message : undefined;
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

function appendText(buffer: string, addition: string): string {
  if (!addition) return buffer;
  return buffer ? `${buffer}\n${addition}` : addition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
