import {
  buildFlueTranscript,
  runFlueSession,
  type FlueSessionResult,
} from "@browserbasehq/stagehand-integrations-flue-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedFlueToolAdapter } from "./flueToolAdapter.js";
import { flueAdapter } from "./harnesses/flueAdapter.js";
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

export interface FlueRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedFlueToolAdapter;
  signal?: AbortSignal;
  runSession?: typeof runFlueSession;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedFlueResult extends ParsedEvalResult {}

function composeFlueToolInstructions(toolInstructions?: string): string {
  return [
    toolInstructions ?? "Use the available browser tools to complete the task.",
    "Your only browser access is through the provided tools. Do not use shell or file tools.",
  ].join("\n");
}

export function buildFluePrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions: composeFlueToolInstructions(toolInstructions),
    resultContract: "marker",
  });
}

export function parseFlueResult(raw: string): ParsedFlueResult {
  return parseEvalResult(raw);
}

export async function runFlueAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  runSession,
  verifier,
}: FlueRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: composeFlueToolInstructions(toolAdapter?.promptInstructions),
    captureEvidence: toolAdapter?.captureEvidence,
    drainStepObservations: toolAdapter?.drainStepObservations,
    observedToolMatcher: toolAdapter?.observedToolMatcher,
  };
  return runExternalHarnessTask({
    harness: "flue",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Flue did not report success",
    parseResult: parseFlueResult,
    runSession: async (prompt) => {
      if (!toolAdapter) throw new Error("Flue requires a prepared tool adapter.");
      const result = await (runSession ?? runFlueSession)({
        prompt,
        model,
        logger,
        signal,
        session: {
          tools: toolAdapter.tools,
          instructions: "You are a browser automation agent under evaluation.",
          maxToolSteps: readFlueMaxToolSteps(),
        },
        onToolResult: toolAdapter.onToolResult
          ? (name) => toolAdapter.onToolResult!(name)
          : undefined,
      });
      return toExternalOutcome(result);
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      flueAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.inputTokens,
            output_tokens: raw.tokenUsage.outputTokens,
            cached_input_tokens: raw.tokenUsage.cachedInputTokens,
          },
        },
        taskSpec,
      ),
  });
}

export function readFlueMaxToolSteps(): number {
  for (const key of ["EVAL_FLUE_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function toExternalOutcome(result: FlueSessionResult) {
  const usage = result.tokenUsage;
  return {
    raw: result,
    resultText: result.finalMessage,
    transcriptText: buildFlueTranscript(result.events),
    iterationError: result.iterationError,
    status: result.status,
    stopReason: result.stopReason,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      totalTokens: usage.totalTokens,
    },
    costUsd: usage.costUsd,
    metrics: buildFlueMetrics(result),
  };
}

function buildFlueMetrics(result: FlueSessionResult): Record<string, MetricValue> {
  const usage = result.tokenUsage;
  return {
    flue_input_tokens: metricValue(usage.inputTokens),
    flue_output_tokens: metricValue(usage.outputTokens),
    flue_cached_input_tokens: metricValue(usage.cachedInputTokens),
    flue_cache_creation_input_tokens: metricValue(usage.cacheCreationInputTokens),
    flue_total_tokens: metricValue(usage.totalTokens),
    flue_cost_usd: metricValue(usage.costUsd),
    flue_tool_steps: metricValue(result.events.filter((event) => event.type === "tool").length),
  };
}
