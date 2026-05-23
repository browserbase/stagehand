import type {
  AgentEvidence,
  AgentEvidenceModality,
  TaskSpec,
  Trajectory,
  TrajectoryStep,
} from "@browserbasehq/stagehand";

/**
 * Pure converter from a harness-specific result to a verifier Trajectory.
 * Implementations must be deterministic (no I/O, no mutation of input).
 * Empty `probeEvidence` is allowed — the verifier degrades via the
 * `evidence_insufficient` path; visual-grounding criteria are flagged
 * rather than silently miscredited.
 */
export interface TrajectoryAdapter<THarnessResult> {
  fromHarnessResult(result: THarnessResult, taskSpec: TaskSpec): Trajectory;
}

/**
 * Canonical tool invocation; harnesses parse their event/message logs into
 * this shape before mapping to a TrajectoryStep.
 */
export interface NormalizedToolCall {
  /** Tool name (e.g., "Bash", "mcp__stagehand_browser__run", "container.exec"). */
  name: string;
  /** Tool arguments. Empty object if the harness doesn't surface them. */
  args: Record<string, unknown>;
  /**
   * Tool result. Strings become a text modality; objects become a json modality.
   * `undefined` is allowed (e.g., when the tool failed before producing output).
   */
  result: unknown;
  /** True if the tool reported success. Adapters infer this from harness flags. */
  ok: boolean;
  /** Free-form error string when `ok === false`. */
  error?: string;
  /** Optional reasoning text the assistant emitted before/with this tool call. */
  reasoning?: string;
}

/**
 * Convert a NormalizedToolCall into a Trajectory AgentEvidence. Objects
 * yield both a json modality (structure-preserving) and a stringified text
 * modality (cheap fallback for text-only prompts). probeEvidence is left
 * to the caller — external harnesses don't emit independent observations.
 */
export function actionToAgentEvidence(
  call: Pick<NormalizedToolCall, "result" | "reasoning">,
): AgentEvidence {
  const modalities: AgentEvidenceModality[] = [];

  if (call.reasoning) {
    modalities.push({ type: "text", content: call.reasoning });
  }

  const result = call.result;
  if (result === undefined || result === null) {
    return { modalities };
  }

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
    // Provide both a JSON modality (preserved structure for prompts that
    // accept JSON) and a stringified text modality (cheap fallback for prompts
    // that only consume text). Step 2 relevance scoring tolerates duplicates.
    modalities.push({ type: "json", content: result });
    const asText = safeStringify(result);
    if (asText) {
      modalities.push({ type: "text", content: asText });
    }
  } else {
    // Numbers, booleans, etc. — stringify so the verifier has a text handle.
    modalities.push({ type: "text", content: String(result) });
  }

  return { modalities };
}

export function toolCallToTrajectoryStep(
  index: number,
  call: NormalizedToolCall,
): TrajectoryStep {
  return {
    index,
    actionName: call.name,
    actionArgs: call.args,
    reasoning: call.reasoning ?? "",
    agentEvidence: actionToAgentEvidence(call),
    // External harnesses don't natively produce screenshots/aria/scroll, so
    // probeEvidence stays empty. The verifier handles this via the
    // evidence_insufficient path.
    probeEvidence: {},
    toolOutput: {
      ok: call.ok,
      result: call.result,
      ...(call.error && { error: call.error }),
    },
  };
}

/**
 * Build a `Trajectory` from a sequence of normalized tool calls + the task
 * metadata. Adapters call this after parsing their harness's event log.
 */
export interface BuildTrajectoryOptions {
  taskSpec: TaskSpec;
  toolCalls: NormalizedToolCall[];
  finalAnswer?: string;
  status?: Trajectory["status"];
  /** Token usage if the harness surfaced it; partial fields are filled with 0. */
  usage?: Partial<Trajectory["usage"]>;
}

export function buildTrajectory(opts: BuildTrajectoryOptions): Trajectory {
  const steps: TrajectoryStep[] = opts.toolCalls.map((call, idx) =>
    toolCallToTrajectoryStep(idx, call),
  );

  return {
    task: opts.taskSpec,
    steps,
    finalAnswer: opts.finalAnswer,
    status: opts.status ?? "complete",
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
