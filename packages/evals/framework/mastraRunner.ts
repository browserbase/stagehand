// Phase 1: prompt/parse duplicated from codexRunner.ts on purpose; Phase 2 switches to the shared externalRunner skeleton.
import {
  buildMastraTranscript,
  loadMastraSdk,
  runMastraSession,
  stringifyError,
  toFiniteNumber,
  type MastraSdk,
  type MastraTokenUsage,
} from "@browserbasehq/stagehand-integrations-mastra-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import { datasetPromptGuidance, type ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { mastraAdapter } from "./harnesses/mastraAdapter.js";
import type { PreparedMastraToolAdapter } from "./mastraToolAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { MastraSdk } from "@browserbasehq/stagehand-integrations-mastra-sdk";
export {
  buildMastraTranscript,
  loadMastraSdk,
  normalizeMastraModel,
  runMastraSession,
} from "@browserbasehq/stagehand-integrations-mastra-sdk";

type MetricValue = { count: number; value: number };

export interface MastraRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedMastraToolAdapter;
  signal?: AbortSignal;
  sdk?: MastraSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedMastraResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

export function buildMastraPrompt(plan: ExternalHarnessTaskPlan): string {
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
    "When finished, your final message must be compact JSON matching this schema:",
    '{"success": boolean, "summary": string, "finalAnswer": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseMastraResult(raw: string): ParsedMastraResult {
  const marker = "EVAL_RESULT:";
  const markerIndex = raw.lastIndexOf(marker);
  const candidates =
    markerIndex >= 0
      ? [
          raw.slice(markerIndex + marker.length).trim(),
          raw
            .slice(markerIndex + marker.length)
            .trim()
            .split(/\r?\n/, 1)[0]
            ?.trim(),
        ]
      : [raw.trim(), raw.trim().split(/\r?\n/, 1)[0]?.trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseMastraJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

export async function runMastraAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk,
  verifier,
}: MastraRunnerInput): Promise<TaskResult> {
  const prompt = buildMastraPrompt(plan);
  const sessionResult = await runMastraSession({
    prompt,
    model,
    logger,
    sdk: sdk ?? (await loadMastraSdk()),
    signal,
    session: {
      instructions: toolAdapter?.promptInstructions,
      maxSteps: readMastraMaxSteps(),
      mcpServers: toolAdapter?.mcpServers,
      tools: toolAdapter?.tools,
      mcpTimeoutMs: readPositiveIntEnv("EVAL_MASTRA_MCP_TIMEOUT_MS"),
    },
    onToolResult: toolAdapter?.onToolResult,
  });
  const { events, finalText, iterationError, status, stopReason, tokenUsage } = sessionResult;
  const transcript = buildMastraTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [finalText, transcript, iterationErrorMessage].filter(Boolean).join("\n\n");
  const parsed = parseMastraResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage || finalText || transcript || "Mastra did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    mastraStatus: status,
    ...(stopReason && { mastraStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildMastraMetrics(tokenUsage),
  };
  if (!verifier) return baseResult;

  const finalObservation = await toolAdapter?.captureEvidence?.().catch((): undefined => undefined);
  const stepObservations = await toolAdapter?.drainStepObservations?.();
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      mastraAdapter.fromHarnessResult(
        {
          events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter?.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          finalAnswer: parsed.finalAnswer ?? finalText,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: tokenUsage.inputTokens,
            output_tokens: tokenUsage.outputTokens,
            reasoning_tokens: tokenUsage.reasoningTokens,
            cached_input_tokens: tokenUsage.cachedInputTokens,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "mastra",
    logger,
  });
}

function readMastraMaxSteps(): number {
  for (const key of ["EVAL_MASTRA_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const value = readPositiveIntEnv(key);
    if (value) return value;
  }
  return 50;
}

function readPositiveIntEnv(key: string): number | undefined {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function tryParseMastraJson(candidate: string): Omit<ParsedMastraResult, "raw"> | undefined {
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

function buildMastraMetrics(usage: MastraTokenUsage): Record<string, MetricValue> {
  return {
    mastra_input_tokens: metricValue(usage.inputTokens),
    mastra_cached_input_tokens: metricValue(usage.cachedInputTokens),
    mastra_output_tokens: metricValue(usage.outputTokens),
    mastra_reasoning_output_tokens: metricValue(usage.reasoningTokens),
    mastra_total_tokens: metricValue(usage.totalTokens),
  };
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}
