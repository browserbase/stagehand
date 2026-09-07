import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { GeminiCuaSessionEvent } from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface GeminiCuaRunResult {
  events: GeminiCuaSessionEvent[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  stepObservationsByToolUse?: Map<string, ProbeEvidence>;
}

export class GeminiCuaTrajectoryAdapter implements TrajectoryAdapter<GeminiCuaRunResult> {
  fromHarnessResult(result: GeminiCuaRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    const byId = new Map<string, NormalizedToolCall>();
    let pendingReasoning = "";
    let finalAnswer = result.finalAnswer;

    for (const event of result.events) {
      if (event.type === "assistant") {
        pendingReasoning = event.text;
        if (!result.finalAnswer && event.text) finalAnswer = event.text;
      } else if (event.type === "tool_use") {
        const call: NormalizedToolCall = {
          name: event.name,
          args: event.input,
          result: undefined,
          ok: true,
          reasoning: pendingReasoning.trim() || undefined,
          probeEvidence:
            result.stepObservationsByToolUse?.get(event.id) ??
            result.stepObservations?.find(
              (observation) => observation.runIndex === toolCalls.length,
            )?.evidence,
        };
        pendingReasoning = "";
        toolCalls.push(call);
        byId.set(event.id, call);
      } else {
        const call = byId.get(event.id);
        if (!call) continue;
        call.result = event.response ?? event.text;
        if (event.image?.data)
          call.images = [
            { bytes: Buffer.from(event.image.data, "base64"), mediaType: event.image.mimeType },
          ];
        call.ok = !event.error;
        if (event.error) call.error = event.text;
      }
    }

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation && { finalObservation: result.finalObservation }),
    });
  }
}

export const geminiCuaAdapter = new GeminiCuaTrajectoryAdapter();
