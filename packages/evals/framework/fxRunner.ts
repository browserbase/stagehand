// Prompt builder and result parser are intentionally duplicated from codexRunner.ts for Phase 1;
// Phase 2 switches this to the shared externalRunner skeleton.
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
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { datasetPromptGuidance, type ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedFxToolAdapter } from "./fxToolAdapter.js";
import { readFxMaxAgentSteps } from "./fxToolAdapter.js";
import { fxAdapter } from "./harnesses/fxAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export {
  buildFxTranscript,
  normalizeFxModel,
  runFxSession,
} from "@browserbasehq/stagehand-integrations-fx-sdk";

type MetricValue = { count: number; value: number };

export interface FxRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedFxToolAdapter;
  signal?: AbortSignal;
  verifier?: ExternalHarnessVerifierConfig;
  runProcess?: FxProcessRunner;
  store?: FxSessionStore;
}

export interface ParsedFxResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

export function buildFxPrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return [
    "You are running a browser benchmark task.",
    "",
    `Dataset: ${plan.dataset}`,
    plan.taskId ? `Task ID: ${plan.taskId}` : undefined,
    `Start URL: ${plan.startUrl}`,
    "",
    "Instruction:",
    plan.instruction,
    "",
    datasetPromptGuidance(plan.dataset),
    toolInstructions ?? "Use the available browser/web tools to complete the task.",
    "Do not edit repository files.",
    "At the end, return compact JSON matching this schema:",
    '{"success": boolean, "summary": string, "finalAnswer": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseFxResult(raw: string): ParsedFxResult {
  const marker = "EVAL_RESULT:";
  const markerIndex = raw.lastIndexOf(marker);
  const candidates =
    markerIndex >= 0
      ? [
          raw.slice(markerIndex + marker.length).trim(),
          raw
            .slice(markerIndex + marker.length)
            .trim()
            .split(/\r?\n/u, 1)[0]
            ?.trim(),
        ]
      : [raw.trim(), raw.trim().split(/\r?\n/u, 1)[0]?.trim()];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseFxJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
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
  if (!toolAdapter) throw new EvalsError("fx requires a prepared tool adapter.");
  const prompt = buildFxPrompt(plan, toolAdapter.promptInstructions);
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
  const { events, finalMessage, iterationError, status, stopReason, tokenUsage } = sessionResult;
  const transcriptText = buildFxTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [finalMessage, transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseFxResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage || finalMessage || transcriptText || "fx did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    fxStatus: status,
    ...(stopReason && { fxStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildFxMetrics(tokenUsage),
  };
  if (!verifier) return baseResult;

  const finalObservation = await toolAdapter.captureEvidence?.().catch((): undefined => undefined);
  const stepObservations = await toolAdapter.drainStepObservations?.();
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      fxAdapter.fromHarnessResult(
        {
          events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          finalAnswer: parsed.finalAnswer ?? finalMessage,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: tokenUsage.input_tokens,
            output_tokens: tokenUsage.output_tokens,
            reasoning_tokens: tokenUsage.reasoning_output_tokens,
            cached_input_tokens: tokenUsage.cached_input_tokens,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "fx",
    logger,
  });
}

function tryParseFxJson(candidate: string): Omit<ParsedFxResult, "raw"> | undefined {
  try {
    const parsed = JSON.parse(candidate) as {
      success?: unknown;
      summary?: unknown;
      finalAnswer?: unknown;
    };
    return {
      success: parsed.success === true,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      finalAnswer: typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
    };
  } catch {
    return undefined;
  }
}

function buildFxMetrics(usage: FxTokenUsage): Record<string, MetricValue> {
  const inputTokens = toFiniteNumber(usage.input_tokens);
  const cachedInputTokens = toFiniteNumber(usage.cached_input_tokens);
  const outputTokens = toFiniteNumber(usage.output_tokens);
  const reasoningOutputTokens = toFiniteNumber(usage.reasoning_output_tokens);
  return {
    fx_input_tokens: metricValue(inputTokens),
    fx_cached_input_tokens: metricValue(cachedInputTokens),
    fx_output_tokens: metricValue(outputTokens),
    fx_reasoning_output_tokens: metricValue(reasoningOutputTokens),
    fx_total_tokens: metricValue(
      inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens,
    ),
  };
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}
