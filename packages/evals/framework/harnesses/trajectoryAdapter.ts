import type {
  AgentEvidence,
  AgentEvidenceModality,
  ProbeEvidence,
  TaskSpec,
  Trajectory,
  TrajectoryStep,
} from "stagehand-v3";

export type TerminationReason =
  | "completed"
  | "step_budget"
  | "browser_session_lost"
  | "sdk_error"
  | "aborted";

export type HarnessTrajectory = Trajectory & {
  terminationReason?: TerminationReason;
  harnessImplementation?: { name: string; version: number; sdkVersion?: string };
  harnessConfiguration?: Record<string, unknown>;
  cost_pricing?: { as_of: string; model: string; source: string };
};

export interface TrajectoryAdapter<THarnessResult> {
  fromHarnessResult(result: THarnessResult, taskSpec: TaskSpec): Trajectory;
}

export interface NormalizedToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  error?: string;
  reasoning?: string;
  images?: Array<{ bytes: Buffer; mediaType: string }>;
  probeEvidence?: ProbeEvidence;
}

export function actionToAgentEvidence(
  call: Pick<NormalizedToolCall, "result" | "reasoning" | "images">,
): AgentEvidence {
  const modalities: AgentEvidenceModality[] = [];

  if (call.reasoning) {
    modalities.push({ type: "text", content: call.reasoning });
  }

  const result = call.result;
  if (result !== undefined && result !== null) {
    if (typeof result === "string") {
      if (result.length > 0) {
        modalities.push({ type: "text", content: result });
      }
    } else if (Buffer.isBuffer(result)) {
      modalities.push({
        type: "image",
        bytes: result,
        mediaType: "image/png",
      });
    } else if (typeof result === "object") {
      modalities.push({ type: "json", content: result });
      const asText = safeStringify(result);
      if (asText) {
        modalities.push({ type: "text", content: asText });
      }
    } else {
      modalities.push({ type: "text", content: String(result) });
    }
  }

  if (call.images?.length) {
    for (const image of call.images) {
      modalities.push({
        type: "image",
        bytes: image.bytes,
        mediaType: image.mediaType,
      });
    }
  }

  return { modalities };
}

export function toolCallToTrajectoryStep(call: NormalizedToolCall): TrajectoryStep {
  return {
    actionName: call.name,
    actionArgs: call.args,
    reasoning: call.reasoning ?? "",
    agentEvidence: actionToAgentEvidence(call),
    probeEvidence: call.probeEvidence ?? {},
    toolOutput: {
      ok: call.ok,
      result: call.result,
      ...(call.error && { error: call.error }),
    },
  };
}

export interface BuildTrajectoryOptions {
  taskSpec: TaskSpec;
  toolCalls: NormalizedToolCall[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
}

export function buildTrajectory(opts: BuildTrajectoryOptions): Trajectory {
  const steps: TrajectoryStep[] = opts.toolCalls.map((call) => toolCallToTrajectoryStep(call));

  return {
    task: opts.taskSpec,
    steps,
    finalAnswer: opts.finalAnswer,
    status: opts.status ?? "complete",
    ...(opts.finalObservation && { finalObservation: opts.finalObservation }),
    usage: {
      input_tokens: opts.usage?.input_tokens ?? 0,
      output_tokens: opts.usage?.output_tokens ?? 0,
      ...(opts.usage?.reasoning_tokens !== undefined && {
        reasoning_tokens: opts.usage.reasoning_tokens,
      }),
      ...(opts.usage?.cached_input_tokens !== undefined && {
        cached_input_tokens: opts.usage.cached_input_tokens,
      }),
      ...(opts.usage?.inference_time_ms !== undefined && {
        inference_time_ms: opts.usage.inference_time_ms,
      }),
    },
  };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
