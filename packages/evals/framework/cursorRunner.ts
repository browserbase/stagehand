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
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { cursorAdapter } from "./harnesses/cursorAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { CursorProcessRunner } from "@browserbasehq/stagehand-integrations-cursor-sdk";

export interface CursorRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCursorToolAdapter;
  signal?: AbortSignal;
  runProcess?: CursorProcessRunner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedCursorResult extends ParsedEvalResult {}

const MCP_ONLY_LINE =
  "Your only browser access is the MCP server configured in this workspace; never launch a browser yourself or run shell commands to browse.";

function composeCursorToolInstructions(toolInstructions?: string): string {
  return [
    toolInstructions ?? "Use the available browser/web tools to complete the task.",
    MCP_ONLY_LINE,
    "Do not edit repository files.",
  ].join("\n");
}

export function buildCursorPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions: composeCursorToolInstructions(toolInstructions),
    resultContract: "marker",
  });
}

export function parseCursorResult(raw: string): ParsedCursorResult {
  const parsed = parseEvalResult(raw);
  if (parsed.success) return parsed;
  return { ...parseEvalResult(`EVAL_RESULT: ${raw}`), raw };
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
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: composeCursorToolInstructions(toolAdapter?.promptInstructions),
    captureEvidence: toolAdapter?.captureEvidence,
    drainStepObservations: toolAdapter?.drainStepObservations,
    observedToolMatcher: toolAdapter?.observedToolMatcher,
  };
  return runExternalHarnessTask({
    harness: "cursor",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Cursor did not report success",
    // Cursor often emits the result as fenced/prose JSON without the marker;
    // the lenient retry only runs after the strict parse fails.
    parseResult: parseCursorResult,
    runSession: async (prompt) => {
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
        onToolResult: toolAdapter?.onToolResult
          ? (name) => toolAdapter.onToolResult!(name)
          : undefined,
      });
      const usage = sessionResult.tokenUsage;
      return {
        raw: sessionResult,
        resultText: sessionResult.resultText,
        transcriptText: buildCursorTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
        metrics: buildCursorMetrics(usage, sessionResult.resultEvent, sessionResult.events),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      cursorAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.resultText,
          status,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
        taskSpec,
      ),
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
