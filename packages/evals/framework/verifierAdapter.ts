import {
  V3Evaluator,
  normalizeRubric,
  type AgentInstance,
  type AgentExecuteOptions,
  type AgentResult,
  type EvaluationResult,
  type Rubric,
  type TaskSpec,
  type Trajectory,
  type V3,
} from "@browserbasehq/stagehand";

import { RubricCache } from "./rubricCache.js";
import { TrajectoryRecorder } from "./trajectoryRecorder.js";

export interface RunWithVerifierOptions {
  v3: V3;
  agent: AgentInstance;
  taskSpec: TaskSpec;
  /**
   * Dataset name for rubric cache partitioning. Each task lives under
   * `.rubric-cache/<dataset>/<task-id>.json`.
   */
  dataset: string;
  /** Agent execute options. `instruction` is filled from taskSpec.instruction. */
  agentOptions?: Omit<AgentExecuteOptions, "instruction">;
  /** Override the run id (defaults to ISO timestamp). */
  runId?: string;
  /** Override trajectory persistence root. */
  trajectoryRoot?: string;
}

export interface RunWithVerifierResult {
  trajectory: Trajectory;
  evaluationResult: EvaluationResult;
  agentResult: AgentResult;
  /** Resolved rubric (precomputed, cached, or freshly generated). */
  rubric: Rubric;
  /** Where the trajectory was persisted (or would have been, if disabled). */
  trajectoryDir: string;
}

export async function runWithVerifier(
  opts: RunWithVerifierOptions,
): Promise<RunWithVerifierResult> {
  const { v3, agent, taskSpec, dataset, agentOptions, runId, trajectoryRoot } =
    opts;
  const evaluator = new V3Evaluator(v3, { backend: "verifier" });

  // ── Resolve rubric ──────────────────────────────────────────────────────
  let resolvedRubric: Rubric;
  if (taskSpec.precomputedRubric) {
    resolvedRubric = normalizeRubric(taskSpec.precomputedRubric)!;
  } else if (process.env.VERIFIER_DISABLE_RUBRIC_CACHE === "1") {
    resolvedRubric = await evaluator.generateRubric(taskSpec);
  } else {
    const cache = new RubricCache({ dataset });
    resolvedRubric = await cache.getOrGenerate(taskSpec, evaluator);
  }

  // Hand a fully-hydrated TaskSpec to the verifier so it doesn't regenerate.
  const hydratedTaskSpec: TaskSpec = {
    ...taskSpec,
    precomputedRubric: resolvedRubric,
  };

  // ── Record trajectory around agent.execute() ───────────────────────────
  const recorder = new TrajectoryRecorder({
    taskSpec: hydratedTaskSpec,
    runId,
    outputRoot: trajectoryRoot,
  });
  const { callbacks: userCallbacks, ...restAgentOptions } = agentOptions ?? {};

  let agentResult: AgentResult;
  let recorderStatus: "complete" | "aborted" | "error" = "complete";
  try {
    agentResult = await agent.execute({
      ...restAgentOptions,
      instruction: taskSpec.instruction,
      callbacks: {
        ...userCallbacks,
        onEvidence: async (event) => {
          recorder.record(event);
          await userCallbacks?.onEvidence?.(event);
        },
      },
    });
  } catch (e) {
    recorderStatus = "error";
    // Re-throw after persisting so the bench task can decide how to report.
    const wrapped = e instanceof Error ? e : new Error(String(e));
    try {
      const trajectory = await recorder.finish({ status: recorderStatus });
      Object.assign(wrapped, { trajectoryDir: recorder.directory, trajectory });
    } catch {
      // Persistence failure must not mask the original agent error.
    }
    throw wrapped;
  }

  const trajectory = await recorder.finish({
    status: recorderStatus,
    finalAnswer: agentResult.message,
    usage: agentResult.usage,
  });

  // ── Verify ──────────────────────────────────────────────────────────────
  const evaluationResult = await evaluator.verify(trajectory);
  await recorder.persistResult(evaluationResult);

  return {
    trajectory,
    evaluationResult,
    agentResult,
    rubric: resolvedRubric,
    trajectoryDir: recorder.directory,
  };
}

/**
 * Decide bench task success from an EvaluationResult using the --success flag's
 * semantics.
 *
 * `outcome` (default) — strict binary outcome.
 * `process`           — rubric process score ≥ threshold (default 0.8).
 * `both`              — both conditions must hold.
 */
export type EvalSuccessMode = "outcome" | "process" | "both";

export function resolveEvalSuccessMode(mode: unknown): EvalSuccessMode {
  if (typeof mode !== "string") return "outcome";
  const normalized = mode.trim().toLowerCase();
  if (
    normalized === "outcome" ||
    normalized === "process" ||
    normalized === "both"
  ) {
    return normalized;
  }
  return "outcome";
}

export function evaluationResultToSuccess(
  result: EvaluationResult,
  mode: unknown = "outcome",
  processThreshold = 0.8,
): boolean {
  const resolvedMode = resolveEvalSuccessMode(mode);
  const outcomeOk = result.outcomeSuccess;
  const processOk =
    typeof result.processScore === "number" &&
    result.processScore >= processThreshold;
  switch (resolvedMode) {
    case "outcome":
      return outcomeOk;
    case "process":
      return processOk;
    case "both":
      return outcomeOk && processOk;
  }
}
