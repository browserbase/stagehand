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

import fs from "node:fs/promises";
import path from "node:path";

import type { EvalLogger } from "../logger.js";
import { tracedSpan } from "./braintrust.js";
import { persistAdapterTrajectory } from "./harnesses/persistTrajectory.js";
import { RubricCache } from "./rubricCache.js";
import type { TaskResult } from "./types.js";
import { applyVerdictGates, resolveRequireGrounding, type VerdictGates } from "./verifierGates.js";

const VERIFIER_MODEL_ENV = "EVAL_VERIFIER_MODEL";
const KEYLESS_VERIFIER_PROVIDERS = new Set(["bedrock", "ollama"]);
/**
 * V3Evaluator's built-in default (google/gemini-2.5-flash) was retired
 * 2026-07-09; leaving it in place fails every rubric criterion silently
 * ("Fused judgment call failed"), which scores whole runs as unscored.
 */
export const DEFAULT_VERIFIER_MODEL = "google/gemini-3.5-flash";

/**
 * Build the shared rubric verifier. EVAL_VERIFIER_MODEL makes the verifier
 * independently selectable for external harnesses and normal Stagehand runs
 * alike; otherwise DEFAULT_VERIFIER_MODEL applies.
 */
export function createVerifierEvaluator(v3: V3): V3Evaluator {
  const explicitModel = process.env[VERIFIER_MODEL_ENV]?.trim();
  const modelName = explicitModel || DEFAULT_VERIFIER_MODEL;

  const provider = modelName.includes("/") ? modelName.slice(0, modelName.indexOf("/")) : undefined;
  const apiKey = loadApiKeyFromEnv(provider, () => {});
  // Only an explicit override fails loudly on a missing key; the default lets
  // V3Evaluator resolve credentials itself (tests and keyless environments).
  if (explicitModel && !apiKey && !KEYLESS_VERIFIER_PROVIDERS.has(provider ?? "")) {
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
  /**
   * Matcher for mounted-browser (facade) tool names. When present, a judge
   * pass with zero facade steps is gated (`no_browser_use`).
   */
  isFacadeTool?: (name: string) => boolean;
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
  isFacadeTool,
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
    // The judge's verdict is not the final word: deterministic gates fold in
    // what the trajectory itself proves (an answer exists, the run finished,
    // the browser was used, the numbers came from the target site) and a
    // strict process score that does not credit blocker-walled criteria. See
    // verifierGates.ts for why each exists.
    const gates = applyVerdictGates({
      evaluation: evaluationResult,
      trajectory: hydratedTrajectory,
      isFacadeTool,
      requireGrounding: resolveRequireGrounding(
        verifier.dataset,
        Boolean(verifier.taskSpec.precomputedRubric),
      ),
      rubricItemCount: rubric.items.length,
    });
    const successMode = verifier.successMode ?? process.env.EVAL_SUCCESS_MODE;
    const verifiedSuccess = evaluationResultToSuccess(
      {
        ...evaluationResult,
        outcomeSuccess: gates.outcomeSuccess,
        processScore: gates.processScore,
      },
      successMode,
    );

    const { directory: trajectoryDir, persisted } = await persistAdapterTrajectory({
      trajectory: hydratedTrajectory,
      taskSpec: hydratedSpec,
      evaluationResult,
      outputRoot: verifier.trajectoryRoot,
      runId: verifier.runId,
    });
    if (persisted) await writeGatesFile(trajectoryDir, gates);

    const gateSuffix = gates.outcomeGates.length ? ` gated=${gates.outcomeGates.join(",")}` : "";
    logger.log({
      category,
      message: `result: outcome=${gates.outcomeSuccess} (judge=${gates.judgeOutcomeSuccess}${gateSuffix}) process=${formatProcessScore(gates.processScore)} (lenient=${formatProcessScore(gates.processScoreLenient)}) steps=${hydratedTrajectory.steps.length}`,
      level: 1,
    });

    return {
      ...baseResult,
      _success: verifiedSuccess,
      error: verifiedSuccess ? undefined : (baseResult.error ?? errorMessage),
      outcomeSuccess: gates.outcomeSuccess,
      judgeOutcomeSuccess: gates.judgeOutcomeSuccess,
      outcomeGates: gates.outcomeGates,
      processScore: gates.processScore,
      processScoreStrict: gates.processScoreStrict,
      processScoreLenient: gates.processScoreLenient,
      perCriterion: gates.perCriterion,
      evidenceInsufficient: evaluationResult.evidenceInsufficient,
      ...(gates.grounding && { grounding: gates.grounding }),
      scoringIncomplete: gates.scoringIncomplete,
      criterionCount: rubric.items.length,
      stepCount: hydratedTrajectory.steps.length,
      trajectoryDir,
      metrics: {
        ...(asRecord(baseResult.metrics) ?? {}),
        ...gateMetrics(gates),
      },
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

/**
 * Braintrust-filterable 0/1 metrics for the gates. `answer_grounded` is only
 * emitted when the answer had numeric datums to check, so its average is not
 * diluted by rows the check skipped.
 */
function gateMetrics(gates: VerdictGates): Record<string, { count: number; value: number }> {
  const flag = (value: boolean) => ({ count: 1, value: value ? 1 : 0 });
  return {
    outcome_gated: flag(gates.outcomeGates.length > 0),
    scoring_incomplete: flag(gates.scoringIncomplete),
    blocked_criteria: { count: 1, value: gates.blockedCriteria },
    ...(typeof gates.processScoreLenient === "number" && {
      process_score_lenient: { count: 1, value: gates.processScoreLenient },
    }),
    ...(gates.grounding && {
      answer_grounded: flag(!gates.grounding.gatesOutcome),
    }),
  };
}

/** Sidecar next to scores/result.json so audits can diff judge vs gated verdicts. */
async function writeGatesFile(trajectoryDir: string, gates: VerdictGates): Promise<void> {
  try {
    await fs.writeFile(
      path.join(trajectoryDir, "scores", "gates.json"),
      JSON.stringify(gates, null, 2),
    );
  } catch {
    // Best-effort: the TaskResult already carries the same data.
  }
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
