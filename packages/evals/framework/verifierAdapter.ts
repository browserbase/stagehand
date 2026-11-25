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
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";

import type { EvalLogger } from "../logger.js";
import { tracedSpan } from "./braintrust.js";
import { persistAdapterTrajectory } from "./harnesses/persistTrajectory.js";
import {
  selectVerifierTraceLines,
  verifierTraceEnabled,
  writeVerifierTrace,
} from "./verifierTrace.js";
import type { HarnessTrajectory } from "./harnesses/trajectoryAdapter.js";
import { RubricCache } from "./rubricCache.js";
import { reportRowPhase } from "./rowContext.js";
import type { TaskResult } from "./types.js";
import { applyVerdictGates, resolveRequireGrounding, type VerdictGates } from "./verifierGates.js";

import { DEFAULT_VERIFIER_MODEL, resolveVerifierModel } from "./verifierModel.js";

export { DEFAULT_VERIFIER_MODEL, resolveVerifierModel };

export interface PersistedEvaluationResult extends EvaluationResult {
  judgeOutcomeSuccess: boolean;
  outcomeGates: VerdictGates["outcomeGates"];
  processScoreStrict: number | undefined;
  processScoreLenient: number | undefined;
  judge: EvaluationResult;
}

export interface UngradedVerifierResult {
  graded: false;
  verifierError: string;
  judge?: EvaluationResult;
}

export function buildUngradedVerifierResult(
  verifierError: string,
  judge?: EvaluationResult,
): UngradedVerifierResult {
  return {
    graded: false,
    verifierError: sanitizeErrorMessage(verifierError),
    ...(judge && { judge }),
  };
}

export function getUngradedVerifierResult(
  evaluation: EvaluationResult,
): { graded: false; verifierError: string; judge: EvaluationResult } | undefined {
  if (!evaluation.findings?.some((finding) => finding.category === "verifier_uncertainty")) {
    return undefined;
  }
  return {
    graded: false,
    verifierError: "Verifier returned an uncertainty result; no trustworthy grade was produced.",
    judge: evaluation,
  };
}

export function buildPersistedEvaluationResult(
  evaluation: EvaluationResult,
  gates: VerdictGates,
): PersistedEvaluationResult {
  return {
    ...evaluation,
    outcomeSuccess: gates.outcomeSuccess,
    processScore: gates.processScore,
    ...(gates.perCriterion && { perCriterion: gates.perCriterion }),
    judgeOutcomeSuccess: gates.judgeOutcomeSuccess,
    outcomeGates: gates.outcomeGates,
    processScoreStrict: gates.processScoreStrict,
    processScoreLenient: gates.processScoreLenient,
    judge: evaluation,
  };
}

const KEYLESS_VERIFIER_PROVIDERS = new Set(["bedrock", "ollama"]);

export function createVerifierEvaluator(v3: V3, modelOverride?: string): V3Evaluator {
  const resolved = resolveVerifierModel();
  const explicitModel =
    modelOverride?.trim() || (resolved.source === "env" ? resolved.modelName : undefined);
  const modelName = explicitModel || resolved.modelName;

  const provider = modelName.includes("/") ? modelName.slice(0, modelName.indexOf("/")) : undefined;
  const apiKey = loadApiKeyFromEnv(provider, () => {});
  if (explicitModel && !apiKey && !KEYLESS_VERIFIER_PROVIDERS.has(provider ?? "")) {
    throw new Error(
      `Verifier model is explicitly set to "${modelName}", but no API key was found for provider "${provider ?? "unknown"}".`,
    );
  }

  return new V3Evaluator(v3, {
    backend: "verifier",
    modelName: modelName as AvailableModel,
    ...(apiKey ? { modelClientOptions: { apiKey } } : {}),
  });
}

export type RubricSource = "precomputed" | "cached" | "generated";

export interface ResolveRubricTracedOptions {
  taskSpec: TaskSpec;
  dataset: string;
  cacheRoot?: string;
}

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

export async function verifyTraced(
  evaluator: Pick<V3Evaluator, "verify">,
  trajectory: Trajectory,
  meta: { taskId: string; dataset: string },
): Promise<EvaluationResult> {
  return tracedSpan(
    async (span) => {
      const v = await evaluator.verify(trajectory);
      const rawSteps = asRecord(v.rawSteps);
      const ungraded = getUngradedVerifierResult(v);
      span.log({
        output: v,
        ...(!ungraded && {
          scores: {
            outcome: v.outcomeSuccess ? 1 : 0,
            process: v.processScore,
          },
        }),
        metadata: {
          graded: !ungraded,
          ...(ungraded && { verifierError: ungraded.verifierError }),
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

export interface ExternalHarnessVerifierConfig {
  v3: V3;
  taskSpec: TaskSpec;
  dataset: string;
  successMode?: EvalSuccessMode;
  trajectoryRoot?: string;
  runId?: string;
}

export interface GradeExternalTrajectoryOptions {
  buildTrajectory: () => HarnessTrajectory;
  verifier: ExternalHarnessVerifierConfig;
  baseResult: TaskResult;
  errorMessage: string;
  category: string;
  logger: EvalLogger;
  isFacadeTool?: (name: string) => boolean;
}

export async function gradeExternalTrajectory({
  buildTrajectory,
  verifier,
  baseResult,
  errorMessage,
  category,
  logger,
  isFacadeTool,
}: GradeExternalTrajectoryOptions): Promise<TaskResult> {
  reportRowPhase("verify");
  let capturedTrajectory: HarnessTrajectory | undefined;
  let rawEvaluation: EvaluationResult | undefined;
  let savedDirectory: string | undefined;
  try {
    const trajectory = buildTrajectory();
    capturedTrajectory = trajectory;
    const evaluator = createVerifierEvaluator(verifier.v3);

    const { rubric } = await resolveRubricTraced(evaluator, {
      taskSpec: verifier.taskSpec,
      dataset: verifier.dataset,
    });
    const hydratedSpec: TaskSpec = {
      ...verifier.taskSpec,
      precomputedRubric: rubric,
    };
    const hydratedTrajectory: HarnessTrajectory = { ...trajectory, task: hydratedSpec };
    capturedTrajectory = hydratedTrajectory;

    const traceOn = verifierTraceEnabled();
    const logCountBefore = traceOn ? logger.getLogs({ maxLevel: 2 }).length : 0;
    const evaluationResult = await verifyTraced(evaluator, hydratedTrajectory, {
      taskId: hydratedSpec.id,
      dataset: verifier.dataset,
    });
    rawEvaluation = evaluationResult;
    const ungraded = getUngradedVerifierResult(evaluationResult);
    if (ungraded) {
      throw new Error(ungraded.verifierError);
    }
    const traceLines = traceOn
      ? selectVerifierTraceLines(logger.getLogs({ maxLevel: 2 }), logCountBefore)
      : [];
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
      evaluationResult: buildPersistedEvaluationResult(evaluationResult, gates),
      outputRoot: verifier.trajectoryRoot,
      runId: verifier.runId,
    });
    savedDirectory = trajectoryDir;
    if (persisted) await writeGatesFile(trajectoryDir, gates);
    if (persisted && traceLines.length) {
      const file = await writeVerifierTrace(trajectoryDir, traceLines);
      if (file) logger.log({ category, message: `verifier trace: ${file}`, level: 1 });
    }

    const gateSuffix = gates.outcomeGates.length ? ` gated=${gates.outcomeGates.join(",")}` : "";
    logger.log({
      category,
      message: `result: outcome=${gates.outcomeSuccess} (judge=${gates.judgeOutcomeSuccess}${gateSuffix}) process=${formatProcessScore(gates.processScore)} (lenient=${formatProcessScore(gates.processScoreLenient)}) steps=${hydratedTrajectory.steps.length}`,
      level: 1,
    });

    return {
      ...baseResult,
      _success: verifiedSuccess,
      error: verifiedSuccess
        ? undefined
        : gates.outcomeGates.length > 0 && gates.judgeOutcomeSuccess
          ? `${describeOutcomeGates(gates)} (judge passed; agent said: ${clipError(String(baseResult.error ?? errorMessage))})`
          : (baseResult.error ?? errorMessage),
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
    const message = sanitizeErrorMessage(stringifyVerifierError(verifyError));
    if (capturedTrajectory && !savedDirectory) {
      try {
        const saved = await persistAdapterTrajectory({
          trajectory: capturedTrajectory,
          taskSpec: capturedTrajectory.task ?? verifier.taskSpec,
          evaluationResult: buildUngradedVerifierResult(message, rawEvaluation),
          outputRoot: verifier.trajectoryRoot,
          runId: verifier.runId,
        });
        savedDirectory = saved.directory;
        if (saved.persisted) {
          await fs.writeFile(
            path.join(saved.directory, "scores", "verifier-error.json"),
            JSON.stringify({ verifierError: message, graded: false }, null, 2),
          );
        }
      } catch (persistenceError) {
        logger.warn({
          category,
          level: 1,
          message: `could not persist failed verification: ${sanitizeErrorMessage(stringifyVerifierError(persistenceError))}`,
        });
      }
    }
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
      _success: false,
      agentReportedSuccess: baseResult._success,
      verifierError: message,
      error: `Verification failed: ${message}`,
      ...(savedDirectory && { trajectoryDir: savedDirectory }),
    };
  }
}

function formatProcessScore(score: number | undefined): string {
  return typeof score === "number" ? score.toFixed(2) : "n/a";
}

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

async function writeGatesFile(trajectoryDir: string, gates: VerdictGates): Promise<void> {
  try {
    await fs.writeFile(
      path.join(trajectoryDir, "scores", "gates.json"),
      JSON.stringify(gates, null, 2),
    );
  } catch {}
}

function stringifyVerifierError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || "Error";
  if (typeof value === "string") return value || "unknown verifier error";
  if (value != null) {
    try {
      const json = JSON.stringify(value);
      if (json) return json;
    } catch {}
    return String(value);
  }
  return "unknown verifier error";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

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

const GATE_DESCRIPTIONS: Record<string, string> = {
  no_final_answer: "agent produced no final answer",
  trajectory_error: "trajectory ended in error",
  no_browser_use: "no browser tool calls",
  ungrounded_answer: "answer datums only in search-engine results, never on a target page",
};

function describeOutcomeGates(gates: { outcomeGates: string[] }): string {
  const parts = gates.outcomeGates.map((g) => GATE_DESCRIPTIONS[g] ?? g);
  return `gated: ${gates.outcomeGates.join(",")} — ${parts.join("; ")}`;
}

function clipError(value: string | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}
