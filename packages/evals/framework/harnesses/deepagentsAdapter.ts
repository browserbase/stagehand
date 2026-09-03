/**
 * deepagentsAdapter — converts Deep Agents JSONL events into a `Trajectory`
 * the verifier can consume.
 *
 * Input shape: assistant messages, paired tool_call/tool_result records,
 * terminal final/usage records, and explicit error records. Assistant text is
 * folded into the next tool call as reasoning; MCP server names prefix tool
 * names so observation matching remains unambiguous.
 */
import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface DeepagentsRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class DeepagentsTrajectoryAdapter implements TrajectoryAdapter<DeepagentsRunResult> {
  fromHarnessResult(result: DeepagentsRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const pendingCalls = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";
    let latestAssistant: string | undefined;
    let finalEventText: string | undefined;

    for (const event of result.events) {
      const type = String(event.type ?? "");
      if (type === "assistant" && typeof event.text === "string") {
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${event.text}` : event.text;
        latestAssistant = event.text;
        continue;
      }
      if (type === "final" && typeof event.text === "string") {
        finalEventText = event.text;
        continue;
      }
      if (type === "tool_call") {
        const id = typeof event.id === "string" ? event.id : "";
        const call: NormalizedToolCall = {
          name: qualifiedName(event),
          args: isRecord(event.args) ? event.args : {},
          result: undefined,
          ok: false,
          error: "no tool result",
          reasoning: pendingReasoning || undefined,
        };
        pendingReasoning = "";
        toolCalls.push(call);
        if (id) pendingCalls.set(id, call);
        continue;
      }
      if (type === "tool_result") {
        const id = typeof event.id === "string" ? event.id : "";
        let call = id ? pendingCalls.get(id) : undefined;
        if (!call) {
          call = {
            name: qualifiedName(event),
            args: {},
            result: undefined,
            ok: false,
            reasoning: pendingReasoning || undefined,
          };
          pendingReasoning = "";
          toolCalls.push(call);
        }
        const ok = event.ok === true;
        const text = typeof event.text === "string" ? event.text : "";
        call.result =
          event.structured !== undefined && event.structured !== null ? event.structured : text;
        call.ok = ok;
        call.error = ok ? undefined : text || "tool error";
        call.images = normalizeImages(event.images);
        if (id) pendingCalls.delete(id);
        continue;
      }
      if (type === "error") {
        const message = typeof event.message === "string" ? event.message : "deepagents error";
        toolCalls.push({
          name: "error",
          args: {},
          result: message,
          ok: false,
          error: message,
          reasoning: pendingReasoning || undefined,
        });
        pendingReasoning = "";
      }
    }

    // The Nth recorded observation pairs with the Nth MCP tool call, in
    // stream order. If ordinals differ, attach nothing: misattribution is
    // worse than missing evidence.
    const observations = result.stepObservations ?? [];
    if (observations.length > 0) {
      const observedCalls = toolCalls.filter((call) =>
        result.observedToolName ? result.observedToolName(call.name) : call.name.includes("."),
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
      finalAnswer: result.finalAnswer ?? finalEventText ?? latestAssistant,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation?.screenshot && { finalObservation: result.finalObservation }),
    });
  }
}

export const deepagentsAdapter = new DeepagentsTrajectoryAdapter();

function qualifiedName(event: Record<string, unknown>): string {
  const name = typeof event.name === "string" ? event.name : "tool";
  return typeof event.server === "string" && event.server ? `${event.server}.${name}` : name;
}

function normalizeImages(value: unknown): Array<{ bytes: Buffer; mediaType: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.flatMap((image) => {
    if (!isRecord(image) || typeof image.data !== "string" || typeof image.mime_type !== "string") {
      return [];
    }
    return [{ bytes: Buffer.from(image.data, "base64"), mediaType: image.mime_type }];
  });
  return images.length ? images : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
