import {
  buildGrokBuildTranscript,
  extractGrokBuildToolCall,
  runGrokBuildSession,
  stringifyError,
  type GrokBuildProcessRunner,
  type GrokBuildTokenUsage,
} from "@browserbasehq/stagehand-integrations-grok-build-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedGrokBuildToolAdapter } from "./grokBuildToolAdapter.js";
import { grokBuildAdapter } from "./harnesses/grokBuildAdapter.js";
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

export type { GrokBuildProcessRunner } from "@browserbasehq/stagehand-integrations-grok-build-sdk";

export interface GrokBuildRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedGrokBuildToolAdapter;
  signal?: AbortSignal;
  runProcess?: GrokBuildProcessRunner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedGrokBuildResult extends ParsedEvalResult {}

const MCP_ONLY_LINE =
  "Your only browser access is the MCP server configured in this workspace. Never launch a browser yourself or run shell commands to browse.";

function composeGrokBuildToolInstructions(toolInstructions?: string): string {
  return [
    toolInstructions ?? "Use the available browser tools to complete the task.",
    MCP_ONLY_LINE,
    "For Stagehand snapshots, start with includeIframes:false. Include iframes only when the task needs embedded-frame content; unrelated advertising frames can stall snapshots.",
    "Do not edit repository files.",
  ].join("\n");
}

export function buildGrokBuildPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions: composeGrokBuildToolInstructions(toolInstructions),
    resultContract: "marker",
  });
}

export function parseGrokBuildResult(raw: string): ParsedGrokBuildResult {
  return parseEvalResult(raw);
}

export async function runGrokBuildAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  runProcess,
  verifier,
}: GrokBuildRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: composeGrokBuildToolInstructions(toolAdapter?.promptInstructions),
    captureEvidence: toolAdapter?.captureEvidence,
    drainStepObservations: toolAdapter?.drainStepObservations,
    observedToolMatcher: toolAdapter?.observedToolMatcher,
  };
  return runExternalHarnessTask({
    harness: "grok_build",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Grok Build did not report success",
    parseResult: parseGrokBuildResult,
    runSession: async (prompt) => {
      const sessionResult = await runGrokBuildSession({
        prompt,
        model,
        logger,
        signal,
        runProcess,
        session: {
          ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
          ...(toolAdapter?.env && { env: toolAdapter.env }),
          ...(process.env.EVAL_GROK_BUILD_PATH && {
            binaryPath: process.env.EVAL_GROK_BUILD_PATH,
          }),
          maxTurns: readGrokBuildMaxTurns(),
          ...(process.env.EVAL_GROK_BUILD_SANDBOX && {
            sandbox: process.env.EVAL_GROK_BUILD_SANDBOX,
          }),
        },
        onToolResult: toolAdapter?.onToolResult
          ? (name) => toolAdapter.onToolResult!(name)
          : undefined,
      });
      const usage = sessionResult.tokenUsage;
      return {
        raw: sessionResult,
        resultText: sessionResult.resultText,
        transcriptText: buildGrokBuildTranscript(sessionResult.events),
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
          ...(usage.reported && {
            cachedInputTokens: usage.cachedInputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            reasoningOutputTokens: usage.reasoningOutputTokens,
          }),
        },
        costUsd: sessionResult.costUsd,
        metrics: buildGrokBuildMetrics(usage, sessionResult.endEvent, sessionResult.events),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      grokBuildAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.resultText,
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

export function readGrokBuildMaxTurns(): number {
  for (const key of ["EVAL_GROK_BUILD_MAX_TURNS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function buildGrokBuildMetrics(
  usage: GrokBuildTokenUsage,
  endEvent: Record<string, unknown> | undefined,
  events: Array<Record<string, unknown>>,
): Record<string, MetricValue> {
  const toolSteps = events.filter(
    (event) => extractGrokBuildToolCall(event)?.subtype === "completed",
  ).length;
  return {
    grok_build_input_tokens: metricValue(usage.inputTokens),
    grok_build_output_tokens: metricValue(usage.outputTokens),
    grok_build_total_tokens: metricValue(usage.totalTokens),
    grok_build_cached_input_tokens: metricValue(usage.cachedInputTokens),
    grok_build_reasoning_tokens: metricValue(usage.reasoningOutputTokens),
    grok_build_num_turns: metricValue(endEvent?.num_turns),
    grok_build_tool_steps: metricValue(toolSteps),
  };
}
