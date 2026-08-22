// PHASE 1: buildCursorPrompt/parseCursorResult intentionally duplicate codexRunner.ts; Phase 2 moves both onto the shared externalRunner skeleton once harness/wave-core lands.
import {
  buildCursorTranscript,
  extractCursorToolCall,
  runCursorAgentSession,
  stringifyError,
  type CursorProcessRunner,
  type CursorTokenUsage,
} from "@browserbasehq/stagehand-integrations-cursor-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { PreparedCursorToolAdapter } from "./cursorToolAdapter.js";
import { datasetPromptGuidance, type ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { cursorAdapter } from "./harnesses/cursorAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { CursorProcessRunner } from "@browserbasehq/stagehand-integrations-cursor-sdk";

type MetricValue = { count: number; value: number };

export interface CursorRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCursorToolAdapter;
  signal?: AbortSignal;
  runProcess?: CursorProcessRunner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedCursorResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

export function buildCursorPrompt(
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
    "Your only browser access is the MCP server configured in this workspace; never launch a browser yourself or run shell commands to browse.",
    "Do not edit repository files.",
    "At the end, return compact JSON matching this schema:",
    '{"success": boolean, "summary": string, "finalAnswer": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCursorResult(raw: string): ParsedCursorResult {
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
    const parsed = tryParseCursorJson(stripJsonFence(candidate));
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

export async function runCursorAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  runProcess,
  verifier,
}: CursorRunnerInput): Promise<TaskResult> {
  const prompt = buildCursorPrompt(plan, toolAdapter?.promptInstructions);
  const sessionResult = await runCursorAgentSession({
    prompt,
    model,
    logger,
    signal,
    runProcess,
    session: {
      ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
      ...(toolAdapter?.env && { env: toolAdapter.env }),
      ...(process.env.EVAL_CURSOR_AGENT_PATH && {
        binaryPath: process.env.EVAL_CURSOR_AGENT_PATH,
      }),
      // CURSOR_API_KEY reaches the CLI through the inherited environment;
      // never pass it as --api-key, which would expose it in process listings.
      ...(readCursorSandbox(process.env.EVAL_CURSOR_SANDBOX) && {
        sandbox: readCursorSandbox(process.env.EVAL_CURSOR_SANDBOX),
      }),
      force: true,
      trust: true,
      approveMcps: true,
    },
    maxToolSteps: readCursorMaxToolSteps(),
    onToolResult: toolAdapter?.onToolResult ? (name) => toolAdapter.onToolResult!(name) : undefined,
  });
  const { events, resultEvent, resultText, iterationError, status, stopReason, tokenUsage } =
    sessionResult;
  const transcriptText = buildCursorTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [resultText, transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseCursorResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage || resultText || transcriptText || "Cursor did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    cursorStatus: status,
    ...(stopReason && { cursorStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildCursorMetrics(tokenUsage, resultEvent, events),
  };
  if (!verifier) return baseResult;

  const finalObservation = await toolAdapter?.captureEvidence?.().catch((): undefined => undefined);
  const stepObservations = await toolAdapter?.drainStepObservations?.();
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      cursorAdapter.fromHarnessResult(
        {
          events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter?.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          finalAnswer: parsed.finalAnswer ?? resultText,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "cursor",
    logger,
  });
}

export function readCursorSandbox(value: unknown): "enabled" | "disabled" | undefined {
  return value === "enabled" || value === "disabled" ? value : undefined;
}

export function readCursorMaxToolSteps(): number {
  for (const key of ["EVAL_CURSOR_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function stripJsonFence(candidate: string): string {
  const match = candidate.match(/^```json\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? candidate;
}

function tryParseCursorJson(candidate: string): Omit<ParsedCursorResult, "raw"> | undefined {
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

function buildCursorMetrics(
  usage: CursorTokenUsage,
  resultEvent: Record<string, unknown> | undefined,
  events: Array<Record<string, unknown>>,
): Record<string, MetricValue> {
  const toolSteps = events.filter((event) => {
    const view = extractCursorToolCall(event);
    return view?.subtype === "completed";
  }).length;
  return {
    cursor_input_tokens: metricValue(usage.inputTokens),
    cursor_output_tokens: metricValue(usage.outputTokens),
    cursor_total_tokens: metricValue(usage.totalTokens),
    cursor_duration_ms: metricValue(resultEvent?.duration_ms),
    cursor_tool_steps: metricValue(toolSteps),
  };
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}

function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
