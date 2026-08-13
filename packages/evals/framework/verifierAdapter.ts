import {
  V3Evaluator,
  loadApiKeyFromEnv,
  normalizeRubric,
  type AvailableModel,
  type EvaluationResult,
  type Rubric,
  type TaskSpec,
  type Trajectory,
  type V3,
} from "stagehand-v3";

import type { EvalLogger } from "../logger.js";
import { tracedSpan } from "./braintrust.js";
import { persistAdapterTrajectory } from "./harnesses/persistTrajectory.js";
import { RubricCache } from "./rubricCache.js";
import type { TaskResult } from "./types.js";

const VERIFIER_MODEL_ENV = "EVAL_VERIFIER_MODEL";
const KEYLESS_VERIFIER_PROVIDERS = new Set(["bedrock", "ollama"]);

export function loadVerifierApiKey(provider: string | undefined): string | undefined {
  // Stagehand v3's key loader predates the AI SDK `gateway/*` provider
  // prefix. Vercel AI Gateway uses the same key as Hermes's ai-gateway route.
  if (provider === "gateway") {
    return process.env.AI_GATEWAY_API_KEY?.trim() || undefined;
  }
  return loadApiKeyFromEnv(provider, () => {});
}

/**
 * Build the shared rubric verifier. By default V3Evaluator keeps its existing
 * model selection; EVAL_VERIFIER_MODEL makes the verifier independently
 * selectable for external harnesses and normal Stagehand runs alike.
 */
export function createVerifierEvaluator(v3: V3): V3Evaluator {
  const modelName = process.env[VERIFIER_MODEL_ENV]?.trim();
  if (!modelName) {
    return new V3Evaluator(v3, { backend: "verifier" });
  }

  const provider = modelName.includes("/") ? modelName.slice(0, modelName.indexOf("/")) : undefined;
  const apiKey = loadVerifierApiKey(provider);
  if (!apiKey && !KEYLESS_VERIFIER_PROVIDERS.has(provider ?? "")) {
    throw new Error(
      `${VERIFIER_MODEL_ENV} is set to "${modelName}", but no API key was found for provider "${provider ?? "unknown"}".`,
    );
  }

  return new V3Evaluator(v3, {
    backend: "verifier",
    modelName: modelName as AvailableModel,
    ...(apiKey ? { modelClientOptions: { apiKey } } : {}),
  });
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
        const cache = new RubricCache(cacheRoot ? { dataset, cacheRoot } : { dataset });
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
  /** Treat verifier/trajectory failures as benchmark failures, never agent passes. */
  failClosedOnVerifierError?: boolean;
}

/**
 * Grade an external-harness run with the rubric verifier and fold the verdict
 * into the TaskResult. Never throws: on any failure in the verifier path the
 * the result is returned with `verifierError` set. Callers evaluating a
 * benchmark contract can additionally fail closed instead of inheriting the
 * agent's self-reported status.
 */
export async function gradeExternalTrajectory({
  buildTrajectory,
  verifier,
  baseResult,
  errorMessage,
  category,
  logger,
  failClosedOnVerifierError = false,
}: GradeExternalTrajectoryOptions): Promise<TaskResult> {
  try {
    const trajectory = buildTrajectory();
    const evaluator = createVerifierEvaluator(verifier.v3);

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
    const verifiedSuccess = evaluationResultToSuccess(evaluationResult, successMode);

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
    return {
      ...baseResult,
      ...(failClosedOnVerifierError && {
        _success: false,
        error: baseResult.error ?? `verifier integration failed: ${message}`,
      }),
      verifierError: message,
    };
  }
}

function formatProcessScore(score: number | undefined): string {
  return typeof score === "number" ? score.toFixed(2) : "n/a";
}

/** Always non-empty, so a set `verifierError` is reliably truthy downstream. */
function stringifyVerifierError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || "Error";
  if (typeof value === "string") return value || "unknown verifier error";
  if (value != null) {
    try {
      const json = JSON.stringify(value);
      if (json) return json;
    } catch {
      // not serializable — fall through to String()
    }
    return String(value);
  }
  return "unknown verifier error";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
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
  if (normalized === "outcome" || normalized === "process" || normalized === "both") {
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
    typeof result.processScore === "number" && result.processScore >= processThreshold;
  switch (resolvedMode) {
    case "outcome":
      return outcomeOk;
    case "process":
      return processOk;
    case "both":
      return outcomeOk && processOk;
  }
}
