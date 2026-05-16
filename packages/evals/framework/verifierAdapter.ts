/**
 * verifierAdapter — runs a bench task through the verifier pipeline.
 *
 * Replaces the per-task ScreenshotCollector + V3Evaluator.ask() boilerplate
 * with one call:
 *
 *   const { evaluationResult, trajectory } = await runWithVerifier({
 *     v3,
 *     agent,
 *     taskSpec: { id, instruction, initUrl, precomputedRubric? },
 *     maxSteps: 50,
 *   });
 *
 * Behavior:
 *   1. Resolves the rubric from the task, cache, or evaluator.
 *   2. Wraps agent.execute() with a TrajectoryRecorder subscribed to the bus.
 *   3. Runs V3Evaluator.verify() on the recorded Trajectory.
 *   4. Returns { trajectory, evaluationResult, agentResult }.
 *
 * Persistence and rubric caching are gated by env vars:
 *   VERIFIER_PERSIST_TRAJECTORIES   — on locally, off in CI by default.
 *   VERIFIER_DISABLE_RUBRIC_CACHE   — set to "1" to bypass the cache (forces
 *                                     fresh rubric generation every time).
 */
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
    v3,
    taskSpec: hydratedTaskSpec,
    runId,
    outputRoot: trajectoryRoot,
  });
  recorder.start();

  let agentResult: AgentResult;
  let recorderStatus: "complete" | "aborted" | "error" = "complete";
  try {
    agentResult = await agent.execute({
      ...agentOptions,
      instruction: taskSpec.instruction,
    });
  } catch (e) {
    recorderStatus = "error";
    const trajectory = await recorder.finish({ status: recorderStatus });
    // Re-throw after persisting so the bench task can decide how to report.
    const wrapped = e instanceof Error ? e : new Error(String(e));
    Object.assign(wrapped, { trajectoryDir: recorder.directory, trajectory });
    throw wrapped;
  }

  const trajectory = await recorder.finish({
    status: recorderStatus,
    finalAnswer: agentResult.message,
    usage: agentResult.usage,
  });

  // ── Verify ──────────────────────────────────────────────────────────────
  const evaluationResult = await evaluator.verify(trajectory, hydratedTaskSpec);
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
