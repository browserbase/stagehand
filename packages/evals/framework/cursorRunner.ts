import type { AvailableModel } from "stagehand-v3";
import {
  extractCursorToolCall,
  CURSOR_SDK_VERSION,
  runCursorSdkAgentSession,
  type CursorSdkAgentFactory,
} from "@browserbasehq/stagehand-integrations-cursor-sdk";
import type { EvalLogger } from "../logger.js";
import type { PreparedCursorToolAdapter } from "./cursorToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { cursorAdapter } from "./harnesses/cursorAdapter.js";
import {
  buildExternalHarnessPrompt,
  parseEvalResult,
  type ParsedEvalResult,
  metricValue,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
} from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export interface CursorRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCursorToolAdapter;
  signal?: AbortSignal;
  createAgent?: CursorSdkAgentFactory;
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
  createAgent,
  verifier,
}: CursorRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: composeCursorToolInstructions(toolAdapter?.promptInstructions),
    captureEvidence: toolAdapter?.captureEvidence,
    drainStepObservations: toolAdapter?.drainStepObservations,
    observedToolMatcher: toolAdapter?.observedToolMatcher,
    browserSessionLoss: toolAdapter?.browserSessionLoss,
  };
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: "EVAL_CURSOR_MAX_STEPS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  return runExternalHarnessTask({
    harness: "cursor",
    plan,
    model,
    logger,
    // SDK systemPrompt replaces the entire stock prompt and requires server entitlement.
    systemPromptMode: "task_prefix",
    implementation: { name: "sdk", version: 1, sdkVersion: CURSOR_SDK_VERSION },
    toolAdapter: adapterLike,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Cursor SDK did not report success",
    stepBudget: maxToolSteps,
    stepBudgetUnit: "tool_calls",
    parseResult: parseCursorResult,
    runSession: async (prompt) => {
      const result = await runCursorSdkAgentSession({
        prompt,
        model,
        cwd: toolAdapter?.cwd ?? process.cwd(),
        mcpServers: toolAdapter?.mcpServers ?? {},
        logger,
        signal,
        createAgent,
        maxToolSteps,
        onToolResult: toolAdapter?.onToolResult
          ? (name) => toolAdapter.onToolResult!(name)
          : undefined,
      });
      return {
        raw: result,
        resultText: result.resultText,
        transcriptText: result.events.map((event) => JSON.stringify(event)).join("\n"),
        iterationError: result.iterationError,
        status: result.status,
        stopReason: result.stopReason,
        usage: {
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          totalTokens: result.tokenUsage.totalTokens,
          reported: result.tokenUsage.reported,
          cachedInputTokens: result.tokenUsage.cachedInputTokens,
          cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
          reasoningOutputTokens: result.tokenUsage.reasoningOutputTokens,
        },
        costUsd: result.costUsd,
        metrics: {
          cursor_input_tokens: metricValue(result.tokenUsage.inputTokens),
          cursor_output_tokens: metricValue(result.tokenUsage.outputTokens),
          cursor_total_tokens: metricValue(result.tokenUsage.totalTokens),
          cursor_tool_steps: metricValue(
            result.events.filter((event) => extractCursorToolCall(event)?.subtype === "completed")
              .length,
          ),
        },
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      cursorAdapter.fromHarnessResult(
        {
          events: raw.events,
          finalAnswer: parsed.finalAnswer ?? raw.resultText,
          status,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
        },
        taskSpec,
      ),
  });
}
