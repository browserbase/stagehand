/**
 * eveAdapter — converts Eve's streamed session events into verifier tool
 * calls. Tool requests retain their inputs by callId; results, reasoning,
 * usage, images, and page observations are folded in when their events arrive.
 */
import type { EveEvent } from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface EveRunResult {
  events: EveEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class EveTrajectoryAdapter implements TrajectoryAdapter<EveRunResult> {
  fromHarnessResult(result: EveRunResult, taskSpec: TaskSpec): Trajectory {
    const requests = new Map<
      string,
      { toolName: string; input: Record<string, unknown>; stepIndex?: number }
    >();
    const toolCalls: NormalizedToolCall[] = [];
    // Eve finalizes a step's reasoning block independently of when the step's
    // tool results stream, so reasoning is paired to tool calls by stepIndex
    // rather than by arrival order. Events without a stepIndex fall back to
    // "the reasoning emitted since the last tool result".
    const reasoningByStep = new Map<number, string>();
    for (const event of result.events) {
      const data = isRecord(event.data) ? event.data : undefined;
      if (event.type !== "reasoning.completed" || typeof data?.reasoning !== "string") continue;
      const stepIndex = finiteIndex(data.stepIndex);
      if (stepIndex === undefined) continue;
      const previous = reasoningByStep.get(stepIndex);
      reasoningByStep.set(stepIndex, previous ? `${previous}\n${data.reasoning}` : data.reasoning);
    }
    let pendingReasoning = "";
    let latestAgentMessage: string | undefined;
    const fallbackUsage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
    let failed = false;

    for (const event of result.events) {
      const data = isRecord(event.data) ? event.data : undefined;
      if (event.type === "actions.requested" && Array.isArray(data?.actions)) {
        const stepIndex = finiteIndex(data.stepIndex);
        for (const action of data.actions) {
          if (!isRecord(action) || action.kind !== "tool-call") continue;
          if (typeof action.callId !== "string" || typeof action.toolName !== "string") continue;
          requests.set(action.callId, {
            toolName: action.toolName,
            input: isRecord(action.input) ? action.input : {},
            ...(stepIndex !== undefined && { stepIndex }),
          });
        }
        continue;
      }
      if (event.type === "reasoning.completed" && typeof data?.reasoning === "string") {
        if (finiteIndex(data.stepIndex) !== undefined) continue;
        pendingReasoning = pendingReasoning
          ? `${pendingReasoning}\n${data.reasoning}`
          : data.reasoning;
        continue;
      }
      if (event.type === "action.result") {
        const actionResult = isRecord(data?.result) ? data.result : undefined;
        if (actionResult?.kind !== "tool-result") continue;
        const callId = typeof actionResult.callId === "string" ? actionResult.callId : "";
        const request = requests.get(callId);
        const toolName =
          typeof actionResult.toolName === "string"
            ? actionResult.toolName
            : (request?.toolName ?? "tool");
        const status = typeof data?.status === "string" ? data.status : "failed";
        const ok = status === "completed" && actionResult.isError !== true;
        const errorMessage =
          isRecord(data?.error) && typeof data.error.message === "string"
            ? data.error.message
            : undefined;
        const normalized = normalizeOutput(actionResult.output);
        const stepIndex = finiteIndex(data?.stepIndex) ?? request?.stepIndex;
        const stepReasoning = stepIndex !== undefined ? reasoningByStep.get(stepIndex) : undefined;
        // The first tool call of a step carries the step's reasoning; sibling
        // calls from the same step were chosen by that same reasoning.
        if (stepIndex !== undefined) reasoningByStep.delete(stepIndex);
        const reasoning = stepReasoning ?? pendingReasoning;
        toolCalls.push({
          name: toolName,
          args: request?.input ?? {},
          result: normalized.result,
          ok,
          ...(!ok && { error: errorMessage ?? `tool ${status}` }),
          ...(reasoning && { reasoning }),
          ...(normalized.images.length > 0 && { images: normalized.images }),
        });
        pendingReasoning = "";
        requests.delete(callId);
        continue;
      }
      if (event.type === "message.completed" && typeof data?.message === "string") {
        pendingReasoning = "";
        // Narration before a tool call (finishReason "tool-calls") is not the
        // agent's conclusion; only a terminal reply can stand in as the answer.
        if (data.finishReason !== "tool-calls") latestAgentMessage = data.message;
        continue;
      }
      if (event.type === "step.completed") {
        const usage = isRecord(data?.usage) ? data.usage : undefined;
        fallbackUsage.input_tokens += finiteNumber(usage?.inputTokens);
        fallbackUsage.output_tokens += finiteNumber(usage?.outputTokens);
        fallbackUsage.cached_input_tokens += finiteNumber(usage?.cacheReadTokens);
        continue;
      }
      if (
        event.type === "step.failed" ||
        event.type === "turn.failed" ||
        event.type === "session.failed"
      ) {
        failed = true;
      }
    }

    pairStepObservations(toolCalls, result.stepObservations, result.observedToolName);
    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer: result.finalAnswer ?? latestAgentMessage,
      status: result.status ?? (failed ? "error" : "complete"),
      usage: result.usage ?? fallbackUsage,
      ...(result.finalObservation?.screenshot && { finalObservation: result.finalObservation }),
    });
  }
}

export const eveAdapter = new EveTrajectoryAdapter();

function normalizeOutput(output: unknown): {
  result: unknown;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (!isRecord(output) || !Array.isArray(output.content)) {
    return { result: output, images: [] };
  }
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  const text: string[] = [];
  for (const block of output.content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    else if (block.type === "image" && typeof block.data === "string") {
      text.push("[image]");
      images.push({
        bytes: Buffer.from(block.data, "base64"),
        mediaType: typeof block.mimeType === "string" ? block.mimeType : "image/png",
      });
    }
  }
  return {
    result: output.structuredContent !== undefined ? output.structuredContent : text.join("\n"),
    images,
  };
}

function pairStepObservations(
  toolCalls: NormalizedToolCall[],
  observations: StepObservation[] | undefined,
  observedToolName: ((name: string) => boolean) | undefined,
): void {
  if (!observations?.length) return;
  const observedCalls = toolCalls.filter((call) =>
    observedToolName ? observedToolName(call.name) : true,
  );
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

function finiteIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
