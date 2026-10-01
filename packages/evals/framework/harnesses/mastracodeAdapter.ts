/**
 * mastracodeAdapter converts the mastracode driver's event stream into a
 * verifier trajectory. `tool_start` / `tool_end` pair by toolCallId, and so do
 * per-step probe observations; the driver already attaches the reasoning and
 * narration that preceded each call.
 */
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { MastracodeDriverEvent } from "@browserbasehq/stagehand-integrations-mastracode-sdk";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface MastracodeRunResult {
  events: MastracodeDriverEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
}

interface PendingCall {
  call: NormalizedToolCall;
  images: Array<{ bytes: Buffer; mediaType: string }>;
}

export class MastracodeTrajectoryAdapter implements TrajectoryAdapter<MastracodeRunResult> {
  fromHarnessResult(result: MastracodeRunResult, taskSpec: TaskSpec): Trajectory {
    const calls: PendingCall[] = [];
    const callsById = new Map<string, PendingCall>();
    let lastStepText = "";

    for (const event of result.events) {
      if (event.type === "tool_start") {
        const pending: PendingCall = {
          call: {
            ...(event.toolCallId && { id: event.toolCallId }),
            name: event.toolName || "tool",
            args: isRecord(event.args)
              ? (deepSanitize(event.args) as Record<string, unknown>)
              : event.args === undefined
                ? {}
                : { raw: deepSanitize(event.args) },
            result: "",
            // A call the driver never saw finish did not succeed.
            ok: false,
            ...(event.reasoning && { reasoning: sanitizeErrorMessage(event.reasoning) }),
          },
          images: [],
        };
        calls.push(pending);
        if (event.toolCallId) callsById.set(event.toolCallId, pending);
        continue;
      }
      if (event.type === "tool_end") {
        const pending = callsById.get(event.toolCallId);
        if (!pending) continue;
        const normalized = normalizeResult(event.result);
        const record = isRecord(event.result) ? event.result : undefined;
        const ok = !event.isError && !event.denied && record?.isError !== true;
        pending.call.result = deepSanitize(normalized.result);
        pending.call.ok = ok;
        pending.images = normalized.images;
        if (normalized.images.length > 0) pending.call.images = normalized.images;
        if (!ok) {
          pending.call.error = sanitizeErrorMessage(
            event.denied
              ? "tool call denied"
              : normalized.text || stringify(event.result) || "tool error",
          );
        }
        continue;
      }
      if (event.type === "step" && event.text.trim()) lastStepText = event.text.trim();
    }

    // Observations are recorded as tool results arrive, which need not be the
    // order the calls started in, so they attach by toolCallId only. One with
    // no id, or an id no call carries, is dropped: evidence on the wrong step
    // is worse than a gap.
    for (const observation of result.stepObservations ?? []) {
      const pending = observation.toolCallId ? callsById.get(observation.toolCallId) : undefined;
      if (pending) pending.call.probeEvidence = observation.evidence;
    }

    let finalObservation = result.finalObservation?.screenshot
      ? result.finalObservation
      : undefined;
    for (let index = calls.length - 1; !finalObservation && index >= 0; index -= 1) {
      const image = calls[index]?.images.at(-1);
      if (image) finalObservation = { screenshot: image.bytes };
    }
    const finalAnswer = result.finalAnswer ?? (lastStepText || undefined);

    return buildTrajectory({
      taskSpec,
      toolCalls: calls.map(({ call }) => call),
      finalAnswer: finalAnswer !== undefined ? sanitizeErrorMessage(finalAnswer) : undefined,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(finalObservation && { finalObservation }),
    });
  }
}

export const mastracodeAdapter = new MastracodeTrajectoryAdapter();

/** MCP tool results arrive as `{ content: [...] }`; image parts become trajectory images. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepSanitize(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, deepSanitize(nested)]),
    );
  }
  return value;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
