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

import type { EvalLogger } from "../logger.js";
import { tracedSpan } from "./braintrust.js";
import { persistAdapterTrajectory } from "./harnesses/persistTrajectory.js";
import { RubricCache } from "./rubricCache.js";
import { TrajectoryRecorder } from "./trajectoryRecorder.js";
import type { TaskResult } from "./types.js";

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

/** Where a task's resolved rubric came from. */
export type RubricSource = "precomputed" | "cached" | "generated";

export interface ResolveRubricTracedOptions {
  taskSpec: TaskSpec;
  dataset: string;
  /** Override the rubric cache root (tests). */
  cacheRoot?: string;
}

/**
 * Resolve a task's rubric — precomputed, cached, or freshly generated — inside
 * a `verifier.rubric` span. Single definition shared by the stagehand and
 * external-harness (claude_code/codex) paths so the logged `source` always
 * reflects what actually happened: a cache miss that generates is reported as
 * "generated", never "cached".
 */
export async function resolveRubricTraced(
  evaluator: Pick<V3Evaluator, "generateRubric">,
  { taskSpec, dataset, cacheRoot }: ResolveRubricTracedOptions,
): Promise<{ rubric: Rubric; source: RubricSource }> {
  return tracedSpan(
    async (span) => {
      let rubric: Rubric;
      let source: RubricSource;

      const precomputed = normalizeRubric(taskSpec.precomputedRubric);
      if (precomputed) {
        rubric = precomputed;
        source = "precomputed";
      } else if (process.env.VERIFIER_DISABLE_RUBRIC_CACHE === "1") {
        rubric = await evaluator.generateRubric(taskSpec);
        source = "generated";
      } else {
        const cache = new RubricCache(
          cacheRoot ? { dataset, cacheRoot } : { dataset },
        );
        const cached = await cache.read(taskSpec);
        if (cached) {
          rubric = cached;
          source = "cached";
        } else {
          rubric = await evaluator.generateRubric(taskSpec);
          await cache.write(taskSpec, rubric);
          source = "generated";
        }
      }

      span.log({
        output: {
          source,
          rubric,
        },
        metadata: {
          taskId: taskSpec.id,
          dataset,
          source,
          criterionCount: rubric.items.length,
        },
      });

      return { rubric, source };
    },
    {
      name: "verifier.rubric",
      type: "eval",
      event: {
        input: {
          taskId: taskSpec.id,
          dataset,
          hasPrecomputedRubric: Boolean(taskSpec.precomputedRubric),
          cacheDisabled: process.env.VERIFIER_DISABLE_RUBRIC_CACHE === "1",
        },
      },
    },
  );
}

/**
 * Run V3Evaluator.verify() inside a `verifier.verify` span with the standard
 * scores + evaluation metadata. Single definition shared by the stagehand and
 * external-harness (claude_code/codex) paths.
 */
export async function verifyTraced(
  evaluator: Pick<V3Evaluator, "verify">,
  trajectory: Trajectory,
  meta: { taskId: string; dataset: string },
): Promise<EvaluationResult> {
  return tracedSpan(
    async (span) => {
      const v = await evaluator.verify(trajectory);
      const rawSteps = asRecord(v.rawSteps);
      span.log({
        output: v,
        scores: {
          outcome: v.outcomeSuccess ? 1 : 0,
          process: v.processScore,
        },
        metadata: {
          taskId: meta.taskId,
          dataset: meta.dataset,
          stepCount: trajectory.steps.length,
          criterionCount: v.perCriterion?.length ?? 0,
          findingCount: v.findings?.length ?? 0,
          evidenceInsufficientCount: v.evidenceInsufficient?.length ?? 0,
          firstFailStep: v.firstPointOfFailure?.stepIndex,
          firstFailCode: v.firstPointOfFailure?.errorCode,
          isAmbiguous: v.taskValidity?.isAmbiguous,
          isInvalid: v.taskValidity?.isInvalid,
          ambiguityReason: v.taskValidity?.ambiguityReason,
          invalidReason: v.taskValidity?.invalidReason,
          primaryIntent: rawSteps?.primaryIntent,
          reasoning: rawSteps?.reasoning,
        },
      });
      return v;
    },
    { name: "verifier.verify", type: "eval" },
  );
}

/**
 * Verifier wiring for an external-harness runner (claude_code / codex). The
 * runner's only job is turning its event stream into a Trajectory; everything
 * else — evaluator construction, rubric hydration, verification, persistence,
 * and folding the verdict into the TaskResult — is harness-agnostic and lives
 * in {@link gradeExternalTrajectory}.
 */
export interface ExternalHarnessVerifierConfig {
  /**
   * V3 instance used solely as the LLM-client carrier for V3Evaluator. The
   * instance does NOT need to have `init()` been called — V3Evaluator.verify()
   * uses only `v3.logger` to construct its LLMProvider.
   */
  v3: V3;
  /** TaskSpec to verify against. id + instruction + optional rubric/initUrl. */
  taskSpec: TaskSpec;
  /** Dataset name for rubric cache partitioning (used when no precomputedRubric). */
  dataset: string;
  /** Override --success mode. Defaults to EVAL_SUCCESS_MODE env or "outcome". */
  successMode?: EvalSuccessMode;
  /** Override trajectory persistence root. */
  trajectoryRoot?: string;
  /** Override the run id (defaults to ISO timestamp). */
  runId?: string;
}

export interface GradeExternalTrajectoryOptions {
  /** Builds the harness-specific Trajectory; runs inside the guarded block. */
  buildTrajectory: () => Trajectory;
  verifier: ExternalHarnessVerifierConfig;
  /** The agent's self-reported result to fold the verdict into. */
  baseResult: TaskResult;
  /** Error message for a run the verifier grades as unsuccessful. */
  errorMessage: string;
  /** Logger category ("claude_code" | "codex"). */
  category: string;
  logger: EvalLogger;
}

/**
 * Grade an external-harness run with the rubric verifier and fold the verdict
 * into the TaskResult. Never throws: on any failure in the verifier path the
 * self-reported result is returned with `verifierError` set, so downstream
 * consumers can tell an ungraded run apart from a graded one.
 */
export async function gradeExternalTrajectory({
  buildTrajectory,
  verifier,
  baseResult,
  errorMessage,
  category,
  logger,
}: GradeExternalTrajectoryOptions): Promise<TaskResult> {
  try {
    const trajectory = buildTrajectory();
    const evaluator = new V3Evaluator(verifier.v3, { backend: "verifier" });

    // Hydrate rubric — use precomputed if present, otherwise cache-or-generate.
    const { rubric } = await resolveRubricTraced(evaluator, {
      taskSpec: verifier.taskSpec,
      dataset: verifier.dataset,
    });
    const hydratedSpec: TaskSpec = {
      ...verifier.taskSpec,
      precomputedRubric: rubric,
    };
    const hydratedTrajectory = { ...trajectory, task: hydratedSpec };

    const evaluationResult = await verifyTraced(evaluator, hydratedTrajectory, {
      taskId: hydratedSpec.id,
      dataset: verifier.dataset,
    });
    const successMode = verifier.successMode ?? process.env.EVAL_SUCCESS_MODE;
    const verifiedSuccess = evaluationResultToSuccess(
      evaluationResult,
      successMode,
    );

    const { directory: trajectoryDir } = await persistAdapterTrajectory({
      trajectory: hydratedTrajectory,
      taskSpec: hydratedSpec,
      evaluationResult,
      outputRoot: verifier.trajectoryRoot,
      runId: verifier.runId,
    });

    logger.log({
      category,
      message: `result: outcome=${evaluationResult.outcomeSuccess} process=${formatProcessScore(evaluationResult.processScore)} steps=${hydratedTrajectory.steps.length}`,
      level: 1,
    });

    return {
      ...baseResult,
      _success: verifiedSuccess,
      error: verifiedSuccess ? undefined : (baseResult.error ?? errorMessage),
      outcomeSuccess: evaluationResult.outcomeSuccess,
      processScore: evaluationResult.processScore,
      evidenceInsufficient: evaluationResult.evidenceInsufficient,
      criterionCount: rubric.items.length,
      stepCount: hydratedTrajectory.steps.length,
      trajectoryDir,
    };
  } catch (verifyError) {
    const message = stringifyVerifierError(verifyError);
    logger.warn({
      category,
      message: `verifier integration failed: ${message}`,
      level: 0,
      auxiliary: {
        error: { value: message, type: "string" },
      },
    });
    // Surface the failure on the result — `_success` falls back to the
    // agent's self-report, and downstream consumers must be able to tell
    // this run apart from one the verifier actually graded.
    return { ...baseResult, verifierError: message };
  }
}

function formatProcessScore(score: number | undefined): string {
  return typeof score === "number" ? score.toFixed(2) : "n/a";
}

function stringifyVerifierError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function runWithVerifier(
  opts: RunWithVerifierOptions,
): Promise<RunWithVerifierResult> {
  const { v3, agent, taskSpec, dataset, agentOptions, runId, trajectoryRoot } =
    opts;
  const evaluator = new V3Evaluator(v3, { backend: "verifier" });

  // ── Resolve rubric ──────────────────────────────────────────────────────
  const { rubric: resolvedRubric } = await resolveRubricTraced(evaluator, {
    taskSpec,
    dataset,
  });

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
    agentResult = await tracedSpan(
      async (span) => {
        const result = await agent.execute({
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
        span.log({
          output: { message: result.message?.slice(0, 500) },
          metrics: usageMetrics(result.usage),
        });
        return result;
      },
      { name: "agent.execute", type: "task" },
    );
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
  const evaluationResult = await verifyTraced(evaluator, trajectory, {
    taskId: taskSpec.id,
    dataset,
  });
  await recorder.persistResult(evaluationResult);

  return {
    trajectory,
    evaluationResult,
    agentResult,
    rubric: resolvedRubric,
    trajectoryDir: recorder.directory,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function usageMetrics(
  usage: AgentResult["usage"] | undefined,
): Record<string, number> {
  if (!usage) return {};
  return Object.fromEntries(
    Object.entries(usage).filter(
      (e): e is [string, number] => typeof e[1] === "number",
    ),
  );
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
