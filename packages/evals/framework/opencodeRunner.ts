import {
  buildOpenCodeTranscript,
  OPENCODE_SDK_VERSION,
  runOpenCodeSession,
  type OpenCodeTokenUsage,
  type StartOpenCodeRuntime,
} from "@browserbasehq/stagehand-integrations-opencode-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { opencodeAdapter } from "./harnesses/opencodeAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { PreparedOpenCodeToolAdapter } from "./opencodeToolAdapter.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export interface OpenCodeRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedOpenCodeToolAdapter;
  signal?: AbortSignal;
  startRuntime?: StartOpenCodeRuntime;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedOpenCodeResult extends ParsedEvalResult {}

const MCP_ONLY_LINE =
  "Your only browser access is the MCP server configured for this session. Never use shell, file, web search, or other built-in tools.";

function composeOpenCodeToolInstructions(toolInstructions?: string): string {
  return [
    toolInstructions ?? "Use the available browser tools to complete the task.",
    MCP_ONLY_LINE,
    "Do not edit repository files.",
  ].join("\n");
}

export function buildOpenCodePrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions: composeOpenCodeToolInstructions(toolInstructions),
    resultContract: "marker",
  });
}

export function parseOpenCodeResult(raw: string): ParsedOpenCodeResult {
  return parseEvalResult(raw);
}

export async function runOpenCodeAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  startRuntime,
  verifier,
}: OpenCodeRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: composeOpenCodeToolInstructions(toolAdapter?.promptInstructions),
    captureEvidence: toolAdapter?.captureEvidence,
    drainStepObservations: toolAdapter?.drainStepObservations,
    observedToolMatcher: toolAdapter?.observedToolMatcher,
    browserSessionLoss: toolAdapter?.browserSessionLoss,
  };
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: "EVAL_OPENCODE_MAX_STEPS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  return runExternalHarnessTask({
    harness: "opencode",
    plan,
    model,
    logger,
    systemPromptMode: "native",
    implementation: { name: "sdk", version: 1, sdkVersion: OPENCODE_SDK_VERSION },
    toolAdapter: adapterLike,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "OpenCode did not report success",
    stepBudget: maxToolSteps,
    stepBudgetUnit: "tool_calls",
    parseResult: parseOpenCodeResult,
    runSession: async (prompt, systemPrompt) => {
      if (!toolAdapter) throw new Error("OpenCode requires a prepared tool adapter.");
      const sessionResult = await runOpenCodeSession({
        prompt,
        model,
        logger,
        signal,
        startRuntime,
        systemPrompt,
        maxToolSteps,
        session: {
          config: toolAdapter.config,
          directory: toolAdapter.cwd,
          configRoot: toolAdapter.configRoot,
        },
        onToolResult: toolAdapter.onToolResult
          ? (name, part) => toolAdapter.onToolResult!(name, part)
          : undefined,
      });
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildOpenCodeTranscript(sessionResult.messages),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason: sessionResult.stopReason,
        usage: {
          reported: sessionResult.tokenUsage.reported,
          inputTokens: sessionResult.tokenUsage.inputTokens,
          outputTokens: sessionResult.tokenUsage.outputTokens,
          cachedInputTokens: sessionResult.tokenUsage.cachedInputTokens,
          cacheCreationInputTokens: sessionResult.tokenUsage.cacheCreationInputTokens,
          reasoningOutputTokens: sessionResult.tokenUsage.reasoningOutputTokens,
          totalTokens: sessionResult.tokenUsage.totalTokens,
        },
        costUsd: sessionResult.costUsd,
        metrics: buildOpenCodeMetrics(sessionResult.tokenUsage, sessionResult.costUsd),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      opencodeAdapter.fromHarnessResult(
        {
          messages: raw.messages,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.inputTokens,
            output_tokens: raw.tokenUsage.outputTokens,
            cached_input_tokens: raw.tokenUsage.cachedInputTokens,
            reasoning_tokens: raw.tokenUsage.reasoningOutputTokens,
          },
        },
        taskSpec,
      ),
  });
}

function buildOpenCodeMetrics(
  usage: OpenCodeTokenUsage,
  costUsd?: number,
): Record<string, MetricValue> {
  return {
    opencode_input_tokens: metricValue(usage.inputTokens),
    opencode_output_tokens: metricValue(usage.outputTokens),
    opencode_cached_input_tokens: metricValue(usage.cachedInputTokens),
    opencode_cache_creation_input_tokens: metricValue(usage.cacheCreationInputTokens),
    opencode_reasoning_tokens: metricValue(usage.reasoningOutputTokens),
    opencode_total_tokens: metricValue(usage.totalTokens),
    ...(costUsd !== undefined && { opencode_cost_usd: metricValue(costUsd) }),
  };
}
