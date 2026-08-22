// TODO(Phase 2): buildDeepagentsPrompt/parseDeepagentsResult duplicate codexRunner.ts on purpose; switch to the shared externalRunner skeleton once harness/wave-core lands.
import {
  buildDeepagentsTranscript,
  normalizeDeepagentsModel,
  runDeepagentsSession,
  stringifyError,
  toFiniteNumber,
  type DeepagentsProcessSpawner,
  type DeepagentsTokenUsage,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { PreparedDeepagentsToolAdapter } from "./deepagentsToolAdapter.js";
import { datasetPromptGuidance, type ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { deepagentsAdapter } from "./harnesses/deepagentsAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { DeepagentsProcessSpawner } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
export {
  buildDeepagentsTranscript,
  normalizeDeepagentsModel,
  runDeepagentsSession,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";

type MetricValue = { count: number; value: number };

export interface DeepagentsRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedDeepagentsToolAdapter;
  signal?: AbortSignal;
  spawn?: DeepagentsProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedDeepagentsResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

export const DEEPAGENTS_SYSTEM_PROMPT = `You control one persistent browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Snapshot IDs are
valid only for the latest snapshot of the active page. Snapshot again after navigation or stale IDs.
Do not launch another browser.
`;

export function buildDeepagentsPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
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
    "Do not use file or todo tools for the browser task; only the browser tools matter.",
    "End with this compact JSON marker on the last line:",
    'EVAL_RESULT: {"success": boolean, "summary": string, "finalAnswer": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseDeepagentsResult(raw: string): ParsedDeepagentsResult {
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
    const parsed = tryParseDeepagentsJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

export async function runDeepagentsAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
}: DeepagentsRunnerInput): Promise<TaskResult> {
  const prompt = buildDeepagentsPrompt(plan, toolAdapter?.promptInstructions);
  const sessionResult = await runDeepagentsSession({
    prompt,
    model,
    logger,
    signal,
    spawn,
    session: {
      ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
      ...(toolAdapter?.env && { env: toolAdapter.env }),
      ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
      systemPrompt: DEEPAGENTS_SYSTEM_PROMPT,
      recursionLimit: readDeepagentsRecursionLimit(),
      maxToolSteps: readDeepagentsMaxToolSteps(),
    },
    onToolResult: (_name: string, server?: string) => {
      if (server && toolAdapter?.recordObservation) toolAdapter.recordObservation();
    },
  });
  const { events, finalMessage, iterationError, status, stopReason, tokenUsage } = sessionResult;
  const transcriptText = buildDeepagentsTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [finalMessage, transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseDeepagentsResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage ||
      finalMessage ||
      transcriptText ||
      "Deep Agents did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    deepagentsStatus: status,
    ...(stopReason && { deepagentsStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildDeepagentsMetrics(tokenUsage),
  };
  if (!verifier) return baseResult;

  const finalObservation = await toolAdapter?.captureEvidence?.().catch((): undefined => undefined);
  const stepObservations = await toolAdapter?.drainStepObservations?.();
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      deepagentsAdapter.fromHarnessResult(
        {
          events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter?.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          finalAnswer: parsed.finalAnswer ?? finalMessage,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: tokenUsage.inputTokens,
            output_tokens: tokenUsage.outputTokens,
            reasoning_tokens: tokenUsage.reasoningOutputTokens,
            cached_input_tokens: tokenUsage.cacheReadInputTokens,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "deepagents",
    logger,
  });
}

function readDeepagentsMaxToolSteps(): number {
  for (const key of ["EVAL_DEEPAGENTS_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function readDeepagentsRecursionLimit(): number {
  const parsed = Number.parseInt(process.env.EVAL_DEEPAGENTS_RECURSION_LIMIT ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.max(100, readDeepagentsMaxToolSteps() * 4);
}

function tryParseDeepagentsJson(
  candidate: string,
): Omit<ParsedDeepagentsResult, "raw"> | undefined {
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

function buildDeepagentsMetrics(usage: DeepagentsTokenUsage): Record<string, MetricValue> {
  return {
    deepagents_input_tokens: metricValue(usage.inputTokens),
    deepagents_cached_input_tokens: metricValue(usage.cacheReadInputTokens),
    deepagents_output_tokens: metricValue(usage.outputTokens),
    deepagents_reasoning_output_tokens: metricValue(usage.reasoningOutputTokens),
    deepagents_total_tokens: metricValue(usage.totalTokens),
  };
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}
