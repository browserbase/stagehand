/**
 * TrajectoryAdapter — converts an external harness's natural output (a
 * provider-shaped event/message log) into the Stagehand `Trajectory` shape
 * that V3Evaluator.verify() consumes.
 *
 * The verifier is harness-agnostic (Trajectory + TaskSpec → Verdict; pure
 * function, no live browser). That property is what lets non-Stagehand
 * harnesses — Claude Code, Codex — be scored with the same rubric pipeline
 * we use for Stagehand. Each external harness ships its own
 * `TrajectoryAdapter<THarnessResult>` that maps its tool-call/message log to
 * a `Trajectory`. The verifier never knows which adapter produced it.
 *
 * @see ~/.claude/plans/verifier-rewrite-plan.html §07 "External harness adapters"
 */
import type {
  AgentEvidence,
  AgentEvidenceModality,
  TaskSpec,
  Trajectory,
  TrajectoryStep,
} from "@browserbasehq/stagehand";

/**
 * Adapter interface. Implementations are pure: no I/O, no live browser, no
 * mutation of the input result. The same harness result should always produce
 * the same Trajectory.
 *
 * Empty `probeEvidence` on every step is supported — the verifier degrades
 * gracefully via the `evidence_insufficient` path (paper's uncontrollable-
 * failure principle). Text-heavy tasks (extract, lookup, search) still get a
 * meaningful outcome verdict; visual-grounding criteria get flagged as
 * evidence_insufficient rather than silently miscredited.
 */
export interface TrajectoryAdapter<THarnessResult> {
  /**
   * Convert the external harness's natural output into a Trajectory. Must be
   * deterministic given the input.
   */
  fromHarnessResult(result: THarnessResult, taskSpec: TaskSpec): Trajectory;
}

/**
 * Normalized tool invocation. Adapters parse harness-specific event/message
 * shapes into this canonical structure before mapping to `TrajectoryStep`.
 *
 * The fields are deliberately permissive — harnesses vary in what they
 * surface, and we want a single mapping helper to handle all of them.
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
  /** Wall-clock when the call started. Falls back to call site's "now" if absent. */
  startedAt?: string;
  /** Wall-clock when the call finished. Falls back to startedAt. */
  finishedAt?: string;
}

/**
 * Convert a `NormalizedToolCall` into a Trajectory `AgentEvidence`. Strings
 * map to a single text modality; objects map to a json modality (plus a text
 * modality with the stringified form so plain text-relevance prompts can
 * grok structured output). Reasoning text becomes its own text modality —
 * the verifier weights reasoning highly when grounding criteria without
 * screenshots.
 *
 * `probeEvidence` is intentionally not produced here — external harnesses
 * don't emit independent observations natively. See `actionToProbeEvidence`
 * if a harness eventually grows that capability.
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

/**
 * Materialize a `TrajectoryStep` from a normalized tool call. Centralizes the
 * step-shape contract so every adapter produces verifier-equivalent steps.
 */
export function toolCallToTrajectoryStep(
  index: number,
  call: NormalizedToolCall,
  fallbackTimestamp: string,
): TrajectoryStep {
  const startedAt = call.startedAt ?? fallbackTimestamp;
  const finishedAt = call.finishedAt ?? startedAt;
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
    startedAt,
    finishedAt,
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
  /** Defaults to `now` for both endpoints if the harness didn't track timing. */
  timing?: Partial<Trajectory["timing"]>;
}

export function buildTrajectory(opts: BuildTrajectoryOptions): Trajectory {
  const now = new Date().toISOString();
  const steps: TrajectoryStep[] = opts.toolCalls.map((call, idx) =>
    toolCallToTrajectoryStep(idx, call, now),
  );

  const startedAt = opts.timing?.startedAt ?? steps[0]?.startedAt ?? now;
  const endedAt =
    opts.timing?.endedAt ?? steps[steps.length - 1]?.finishedAt ?? startedAt;

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
    timing: { startedAt, endedAt },
  };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
