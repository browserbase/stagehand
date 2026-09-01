import {
  buildFxTranscript,
  normalizeFxModel,
  runFxSession,
  stringifyError,
  toFiniteNumber,
  type FxProcessRunner,
  type FxSessionStore,
  type FxTokenUsage,
} from "@browserbasehq/stagehand-integrations-fx-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { readFxMaxAgentSteps, type PreparedFxToolAdapter } from "./fxToolAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import { fxAdapter } from "./harnesses/fxAdapter.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export {
  buildFxTranscript,
  normalizeFxModel,
  runFxSession,
} from "@browserbasehq/stagehand-integrations-fx-sdk";

export interface FxRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedFxToolAdapter;
  signal?: AbortSignal;
  verifier?: ExternalHarnessVerifierConfig;
  runProcess?: FxProcessRunner;
  store?: FxSessionStore;
}

export interface ParsedFxResult extends ParsedEvalResult {}

export function buildFxPrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export function parseFxResult(raw: string): ParsedFxResult {
  return parseEvalResult(raw);
}

export async function runFxAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  verifier,
  runProcess,
  store,
}: FxRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: toolAdapter.promptInstructions,
    captureEvidence: toolAdapter.captureEvidence,
    drainStepObservations: toolAdapter.drainStepObservations,
    observedToolMatcher: toolAdapter.observedToolMatcher,
  };
  return runExternalHarnessTask({
    harness: "fx",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "fx did not report success",
    runSession: async (prompt) => {
      const sessionResult = await runFxSession({
        prompt,
        model: normalizeFxModel(model),
        cwd: toolAdapter.cwd,
        home: toolAdapter.home,
        env: toolAdapter.env,
        permissionMode: process.env.EVAL_FX_PERMISSION_MODE === "yolo" ? "yolo" : "auto",
        maxAgentSteps: readFxMaxAgentSteps(),
        signal,
        logger,
        runProcess,
        store,
        onToolStep: toolAdapter.recordObservation
          ? async () => toolAdapter.recordObservation?.()
          : undefined,
        observedTool: toolAdapter.observedToolMatcher,
      });
      const usage = normalizeFxUsage(sessionResult.tokenUsage);
      return {
        raw: sessionResult,
        resultText: sessionResult.status === "completed" ? sessionResult.finalMessage : "",
        transcriptText: buildFxTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage,
        ...(typeof sessionResult.tokenUsage.total_cost === "number" &&
          Number.isFinite(sessionResult.tokenUsage.total_cost) && {
            costUsd: sessionResult.tokenUsage.total_cost,
          }),
        metrics: buildFxMetrics(sessionResult.tokenUsage),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      fxAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          observedToolCallKeys: raw.observedToolCallKeys,
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.input_tokens,
            output_tokens: raw.tokenUsage.output_tokens,
            reasoning_tokens: raw.tokenUsage.reasoning_output_tokens,
            cached_input_tokens: raw.tokenUsage.cached_input_tokens,
          },
        },
        taskSpec,
      ),
  });
}

function normalizeFxUsage(usage: FxTokenUsage) {
  const inputTokens = toFiniteNumber(usage.input_tokens);
  const cachedInputTokens = toFiniteNumber(usage.cached_input_tokens);
  const outputTokens = toFiniteNumber(usage.output_tokens);
  const reasoningOutputTokens = toFiniteNumber(usage.reasoning_output_tokens);
  // fx reports cached input and reasoning output as separate token buckets.
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens,
  };
}

function buildFxMetrics(usage: FxTokenUsage): Record<string, MetricValue> {
  const normalized = normalizeFxUsage(usage);
  return {
    fx_input_tokens: metricValue(normalized.inputTokens),
    fx_cached_input_tokens: metricValue(normalized.cachedInputTokens),
    fx_output_tokens: metricValue(normalized.outputTokens),
    fx_reasoning_output_tokens: metricValue(normalized.reasoningOutputTokens),
    fx_total_tokens: metricValue(normalized.totalTokens),
  };
}
