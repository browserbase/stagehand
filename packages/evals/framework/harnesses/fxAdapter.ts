import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type {
  FxEvent,
  FxToolCallRecord,
  FxToolResultRecord,
} from "@browserbasehq/stagehand-integrations-fx-sdk";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface FxRunResult {
  events: FxEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
  observedToolCallKeys?: string[];
}

export class FxTrajectoryAdapter implements TrajectoryAdapter<FxRunResult> {
  fromHarnessResult(result: FxRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const toolCallKeys: string[] = [];
    let latestAgentMessage: string | undefined;

    for (const event of result.events) {
      if (event.type === "assistant") {
        latestAgentMessage = event.text;
        continue;
      }
      if (event.type !== "tool_step") continue;

      const resultsById = new Map<string, FxToolResultRecord>();
      for (const toolResult of event.tool_results) {
        if (typeof toolResult.tool_call_id === "string") {
          resultsById.set(toolResult.tool_call_id, toolResult);
        }
      }
      event.tool_calls.forEach((call, index) => {
        const toolResult = typeof call.id === "string" ? resultsById.get(call.id) : undefined;
        toolCalls.push(normalizeFxToolCall(call, toolResult, index === 0 ? event.assistant : ""));
        toolCallKeys.push(fxToolCallKey(call));
      });
    }

    pairStepObservations(toolCalls, toolCallKeys, result);

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer ?? latestAgentMessage,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation?.screenshot && {
        finalObservation: result.finalObservation,
      }),
    });
  }
}

export const fxAdapter = new FxTrajectoryAdapter();

function normalizeFxToolCall(
  call: FxToolCallRecord,
  toolResult: FxToolResultRecord | undefined,
  reasoning: string,
): NormalizedToolCall {
  const args = parseArgs(call.arguments_json);
  const output = typeof toolResult?.output === "string" ? toolResult.output : "";
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  const parsedOutput = tryParseJson(output);
  const result = parsedOutput === undefined ? output : replaceImageBlocks(parsedOutput, images);
  const ok = toolResult?.status === "success";
  return {
    name: typeof call.name === "string" ? call.name : "unknown_tool",
    args,
    result,
    ok,
    ...(!ok && output && { error: clip(output, 500) }),
    ...(reasoning && { reasoning }),
    ...(images.length > 0 && { images }),
  };
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const parsed = tryParseJson(value);
  return isRecord(parsed) ? parsed : { raw: value };
}

function replaceImageBlocks(
  value: unknown,
  images: Array<{ bytes: Buffer; mediaType: string }>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceImageBlocks(item, images));
  if (!isRecord(value)) return value;
  if (
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    images.push({ bytes: Buffer.from(value.data, "base64"), mediaType: value.mimeType });
    return "[image]";
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceImageBlocks(item, images)]),
  );
}

function fxToolCallKey(call: FxToolCallRecord): string {
  const name = typeof call.name === "string" ? call.name : "";
  return typeof call.id === "string" ? call.id : `${name}:${call.arguments_json ?? ""}`;
}

function pairStepObservations(
  toolCalls: NormalizedToolCall[],
  toolCallKeys: string[],
  result: FxRunResult,
): void {
  const observations = result.stepObservations ?? [];
  if (observations.length === 0) return;
  if (result.observedToolCallKeys !== undefined) {
    for (const observation of observations) {
      const key = result.observedToolCallKeys[observation.runIndex];
      if (key === undefined) continue;
      const callIndex = toolCallKeys.indexOf(key);
      const call = callIndex >= 0 ? toolCalls[callIndex] : undefined;
      if (call) call.probeEvidence = observation.evidence;
    }
    return;
  }
  const observedCalls = toolCalls.filter((call) =>
    result.observedToolName ? result.observedToolName(call.name) : call.name.startsWith("mcp_"),
  );
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

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
