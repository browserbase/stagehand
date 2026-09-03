/**
 * mastraAdapter converts Mastra `fullStream` chunks into verifier trajectories.
 * Tool calls and results are paired by toolCallId; reasoning/text preceding a
 * call belongs to that step, while text after the last call is the final answer.
 */
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface MastraRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

interface PendingCall {
  id: string;
  call: NormalizedToolCall;
  images: Array<{ bytes: Buffer; mediaType: string }>;
}

export class MastraTrajectoryAdapter implements TrajectoryAdapter<MastraRunResult> {
  fromHarnessResult(result: MastraRunResult, taskSpec: TaskSpec): Trajectory {
    const calls: PendingCall[] = [];
    const callsById = new Map<string, PendingCall>();
    const trailingTextParts: string[] = [];
    let pendingReasoning = "";
    let lastDeltaType: "reasoning" | "text" | undefined;

    for (const event of result.events) {
      const type = String(event.type ?? "");
      const payload = isRecord(event.payload) ? event.payload : {};
      if (type === "reasoning-delta" && typeof payload.text === "string") {
        pendingReasoning = appendDelta(
          pendingReasoning,
          payload.text,
          lastDeltaType !== "reasoning",
        );
        lastDeltaType = "reasoning";
        continue;
      }
      if (type === "text-delta" && typeof payload.text === "string") {
        pendingReasoning = appendDelta(pendingReasoning, payload.text, lastDeltaType !== "text");
        lastDeltaType = "text";
        trailingTextParts.push(payload.text);
        continue;
      }
      if (type === "tool-call") {
        const id = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
        const args = isRecord(payload.args) ? { ...payload.args } : {};
        delete args.__mastraMetadata;
        const pending: PendingCall = {
          id,
          call: {
            name: typeof payload.toolName === "string" ? payload.toolName : "tool",
            args: deepSanitize(args) as Record<string, unknown>,
            result: "",
            ok: true,
            reasoning: sanitizeErrorMessage(pendingReasoning.trim()) || undefined,
          },
          images: [],
        };
        calls.push(pending);
        callsById.set(id, pending);
        pendingReasoning = "";
        lastDeltaType = undefined;
        trailingTextParts.length = 0;
        continue;
      }
      if (type === "tool-result") {
        const id = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
        const pending = callsById.get(id);
        if (!pending) continue;
        const normalized = normalizeResult(payload.result);
        const rawResult = payload.result;
        const rawRecord = isRecord(rawResult) ? rawResult : undefined;
        const ok =
          payload.isError !== true &&
          rawRecord?.isError !== true &&
          !(rawRecord && rawRecord.ok === false);
        pending.call.result = deepSanitize(normalized.result);
        pending.call.ok = ok;
        pending.images = normalized.images;
        if (normalized.images.length > 0) pending.call.images = normalized.images;
        if (!ok) {
          pending.call.error = sanitizeErrorMessage(
            normalized.text ||
              (typeof rawRecord?.error === "string" ? rawRecord.error : stringifyError(rawResult)),
          );
        }
        continue;
      }
      if (type === "tool-error") {
        const id = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
        const pending = callsById.get(id);
        if (!pending) continue;
        const message = sanitizeErrorMessage(stringifyError(payload.error) || "tool error");
        pending.call.result = message;
        pending.call.ok = false;
        pending.call.error = message;
      }
    }

    const observationsByRunIndex = new Map(
      (result.stepObservations ?? []).map((observation) => [
        observation.runIndex,
        observation.evidence,
      ]),
    );
    const isObserved = result.observedToolName ?? (() => true);
    let runOrdinal = 0;
    for (const pending of calls) {
      if (!isObserved(pending.call.name)) continue;
      const observation = observationsByRunIndex.get(runOrdinal++);
      if (observation) pending.call.probeEvidence = observation;
    }

    let finalObservation = result.finalObservation?.screenshot
      ? result.finalObservation
      : undefined;
    for (let index = calls.length - 1; !finalObservation && index >= 0; index -= 1) {
      const image = calls[index]?.images.at(-1);
      if (image) finalObservation = { screenshot: image.bytes };
    }
    const trailing = trailingTextParts.join("").trim();

    return buildTrajectory({
      taskSpec,
      toolCalls: calls.map(({ call }) => call),
      finalAnswer:
        result.finalAnswer !== undefined
          ? sanitizeErrorMessage(result.finalAnswer)
          : trailing
            ? sanitizeErrorMessage(trailing)
            : undefined,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(finalObservation && { finalObservation }),
    });
  }
}

export const mastraAdapter = new MastraTrajectoryAdapter();

function normalizeResult(value: unknown): {
  result: unknown;
  text: string;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return {
      result: value ?? "",
      text:
        typeof value === "string"
          ? value
          : isRecord(value) && typeof value.error === "string"
            ? value.error
            : "",
      images: [],
    };
  }
  const parts: string[] = [];
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  for (const block of value.content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image" && typeof block.data === "string") {
      images.push({
        bytes: Buffer.from(block.data, "base64"),
        mediaType: typeof block.mimeType === "string" ? block.mimeType : "image/png",
      });
      parts.push("[image]");
    }
  }
  const text = parts.join("\n");
  return { result: images.length > 0 ? text : value.content, text, images };
}

/**
 * Streamed deltas are token fragments of one contiguous block — concatenate
 * them directly; a newline is inserted only when a new block type starts
 * (reasoning → text), never between fragments.
 */
function appendDelta(buffer: string, addition: string, startsNewBlock: boolean): string {
  if (!buffer) return addition;
  return startsNewBlock ? `${buffer}\n${addition}` : buffer + addition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deepSanitize(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, deepSanitize(nestedValue)]),
    );
  }
  return value;
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}
