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

import { tracedSpan } from "./braintrust.js";
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

/** Where a task's resolved rubric came from. */
export type RubricSource = "precomputed" | "cached" | "generated";

/** The slice of V3Evaluator that rubric resolution needs. */
export interface RubricGenerator {
  generateRubric(taskSpec: TaskSpec): Promise<Rubric>;
}

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
  evaluator: RubricGenerator,
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

/** The slice of V3Evaluator that traced verification needs. */
export interface TrajectoryVerifier {
  verify(trajectory: Trajectory): Promise<EvaluationResult>;
}

/**
 * Run V3Evaluator.verify() inside a `verifier.verify` span with the standard
 * scores + evaluation metadata. Single definition shared by the stagehand and
 * external-harness (claude_code/codex) paths.
 */
export async function verifyTraced(
  evaluator: TrajectoryVerifier,
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
