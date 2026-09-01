import {
  buildPiTranscript,
  runPiSession,
  stringifyError,
  type PiSdk,
} from "@browserbasehq/stagehand-integrations-pi-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import { piAdapter } from "./harnesses/piAdapter.js";
import type { PreparedPiToolAdapter } from "./piToolAdapter.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { PiSdk } from "@browserbasehq/stagehand-integrations-pi-sdk";
export {
  buildPiTranscript,
  loadPiSdk,
  normalizePiModel,
  runPiSession,
} from "@browserbasehq/stagehand-integrations-pi-sdk";

export interface PiRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedPiToolAdapter;
  signal?: AbortSignal;
  sdk?: PiSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedPiResult extends ParsedEvalResult {}

export function buildPiPrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return buildExternalHarnessPrompt({ plan, toolInstructions, resultContract: "marker" });
}

export function parsePiResult(raw: string): ParsedPiResult {
  return parseEvalResult(raw);
}

export async function runPiAgent(input: PiRunnerInput): Promise<TaskResult> {
  const { plan, model, logger, toolAdapter, signal, sdk, verifier } = input;
  // pi budgets turns (a turn may hold several tool calls), so the shared tool-step budget is a mild over-allowance.
  const maxTurns = resolveStepBudget({
    harnessEnvKey: "EVAL_PI_MAX_TURNS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  return runExternalHarnessTask({
    harness: "pi",
    plan,
    model,
    logger,
    toolAdapter,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "pi did not report success",
    stepBudget: maxTurns,
    runSession: async (prompt) => {
      const sessionResult = await runPiSession({
        prompt,
        model,
        logger,
        sdk,
        signal,
        session: {
          ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
          // Appended to pi's stock prompt (same shape as claude_code's
          // preset+append); replacing the stock prompt made the agent quit early.
          appendSystemPrompt:
            "You are being evaluated. Do not edit repository files. Complete the browser task with the provided browser tools and emit the requested EVAL_RESULT line.",
          maxTurns,
          ...(process.env.EVAL_PI_THINKING && {
            thinkingLevel: process.env.EVAL_PI_THINKING,
          }),
          ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
          ...(toolAdapter?.customTools && { customTools: toolAdapter.customTools }),
        },
        onToolResult: toolAdapter?.onToolResult,
      });
      const usage = sessionResult.tokenUsage;
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildPiTranscript(sessionResult.events),
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
          cachedInputTokens: usage.cacheReadTokens,
          cacheCreationInputTokens: usage.cacheWriteTokens,
          ...(usage.reasoningTokens !== undefined && {
            reasoningOutputTokens: usage.reasoningTokens,
          }),
          totalTokens: usage.totalTokens,
        },
        ...(usage.costUsd > 0 && { costUsd: usage.costUsd }),
        metrics: { pi_turns: metricValue(sessionResult.turns) },
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      piAdapter.fromHarnessResult(
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
            reasoning_tokens: raw.tokenUsage.reasoningTokens,
            cached_input_tokens: raw.tokenUsage.cacheReadTokens,
          },
        },
        taskSpec,
      ),
  });
}
