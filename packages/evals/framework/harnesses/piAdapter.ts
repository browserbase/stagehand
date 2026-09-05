/**
 * piAdapter — converts pi AgentSession events into a verifier `Trajectory`.
 *
 * Assistant message_end events provide reasoning/tool calls/final text;
 * tool_execution_start/end events provide arguments, results, errors, and images.
 */
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface PiRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class PiTrajectoryAdapter implements TrajectoryAdapter<PiRunResult> {
  fromHarnessResult(result: PiRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const registered = new Map<string, { name: string; args?: Record<string, unknown> }>();
    const startedArgs = new Map<string, Record<string, unknown>>();
    let pendingReasoning = "";
    let latestAssistantText: string | undefined;

    for (const event of result.events) {
      const type = String(event.type ?? "");
      if (type === "message_end" && isRecord(event.message)) {
        const message = event.message;
        if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
        const reasoningParts: string[] = [];
        const toolBlocks: Record<string, unknown>[] = [];
        for (const block of message.content) {
          if (!isRecord(block)) continue;
          if (block.type === "text" && typeof block.text === "string") {
            reasoningParts.push(block.text);
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            reasoningParts.push(block.thinking);
          } else if (block.type === "toolCall") {
            toolBlocks.push(block);
            if (typeof block.id === "string") {
              registered.set(block.id, {
                name: typeof block.name === "string" ? block.name : "tool",
                ...(isRecord(block.arguments) && { args: block.arguments }),
              });
            }
          }
        }
        const text = reasoningParts.join("\n");
        if (toolBlocks.length > 0) {
          pendingReasoning = text;
        } else {
          latestAssistantText = text;
          pendingReasoning = "";
        }
        continue;
      }

      if (type === "tool_execution_start" && typeof event.toolCallId === "string") {
        startedArgs.set(event.toolCallId, isRecord(event.args) ? event.args : {});
        continue;
      }

      if (type === "tool_execution_end") {
        const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
        const registration = registered.get(id);
        const resultValue = event.result;
        const normalized = normalizeResult(resultValue);
        const isError = event.isError === true;
        toolCalls.push({
          name:
            typeof event.toolName === "string" ? event.toolName : (registration?.name ?? "tool"),
          args: registration?.args ?? startedArgs.get(id) ?? {},
          result: normalized.result,
          ok: !isError,
          ...(isError && { error: normalized.text || "tool failed" }),
          reasoning: pendingReasoning || undefined,
          ...(normalized.images.length > 0 && { images: normalized.images }),
        });
        pendingReasoning = "";
      }
    }

    const observations = result.stepObservations ?? [];
    if (observations.length > 0) {
      const observedCalls = toolCalls.filter((call) =>
        result.observedToolName
          ? result.observedToolName(call.name)
          : call.name.startsWith("mcp__"),
      );
      const totalObservedRuns = Math.max(...observations.map((o) => o.runIndex)) + 1;
      if (observedCalls.length === totalObservedRuns) {
        const observationsByRunIndex = new Map(observations.map((o) => [o.runIndex, o.evidence]));
        observedCalls.forEach((call, ordinal) => {
          const observation = observationsByRunIndex.get(ordinal);
          if (observation) call.probeEvidence = observation;
        });
      }
    }

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer ?? latestAssistantText,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation?.screenshot && {
        finalObservation: result.finalObservation,
      }),
    });
  }
}

export const piAdapter = new PiTrajectoryAdapter();

function normalizeResult(value: unknown): {
  result: unknown;
  text: string;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (typeof value === "string") return { result: value, text: value, images: [] };
  if (!isRecord(value)) return { result: value, text: "", images: [] };
  const text: string[] = [];
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") text.push(block.text);
      if (
        block.type === "image" &&
        typeof block.data === "string" &&
        typeof block.mimeType === "string"
      ) {
        images.push({ bytes: Buffer.from(block.data, "base64"), mediaType: block.mimeType });
      }
    }
  }
  const joined = text.join("\n");
  const hasStructuredDetails =
    value.details !== undefined &&
    (!isRecord(value.details) || Object.keys(value.details).length > 0);
  return {
    result: hasStructuredDetails ? value.details : joined || value,
    text: joined,
    images,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
