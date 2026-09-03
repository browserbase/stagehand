import {
  buildClaudeCodeTranscript,
  extractClaudeCodeTokenUsage,
  normalizeClaudeModel,
  runClaudeAgentSession,
  type ClaudeAgentSdk,
  type ClaudeSdkMessage,
} from "@browserbasehq/stagehand-integrations-claude-agent-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { PreparedClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { claudeCodeAdapter } from "./harnesses/claudeCodeAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { ClaudeAgentSdk };
export { isClaudeCodeMaxTurnsError } from "@browserbasehq/stagehand-integrations-claude-agent-sdk";

export interface ClaudeCodeRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedClaudeCodeToolAdapter;
  signal?: AbortSignal;
  sdk?: ClaudeAgentSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedClaudeCodeResult extends ParsedEvalResult {}

export function normalizeClaudeCodeModel(model: AvailableModel): string {
  return normalizeClaudeModel(model);
}

export function buildClaudeCodePrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({ plan, toolInstructions, resultContract: "marker" });
}

export function parseClaudeCodeResult(raw: string): ParsedClaudeCodeResult {
  return parseEvalResult(raw);
}

export async function runClaudeCodeAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk,
  verifier,
}: ClaudeCodeRunnerInput): Promise<TaskResult> {
  return runExternalHarnessTask({
    harness: "claude_code",
    plan,
    logger,
    toolAdapter,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Claude Code did not report success",
    runSession: async (prompt) => {
      const sessionResult = await runClaudeAgentSession({
        prompt,
        model,
        logger,
        sdk,
        signal,
        session: {
          allowedTools:
            toolAdapter?.allowedTools ??
            readCsvEnv("EVAL_CLAUDE_CODE_ALLOWED_TOOLS", ["WebFetch", "WebSearch"]),
          permissionMode: process.env.EVAL_CLAUDE_CODE_PERMISSION_MODE ?? "default",
          maxTurns: readPositiveIntEnv("EVAL_CLAUDE_CODE_MAX_TURNS", 50),
          pathToClaudeCodeExecutable: process.env.EVAL_CLAUDE_CODE_EXECUTABLE || undefined,
          cwd: toolAdapter?.cwd,
          env: toolAdapter?.env,
          mcpServers: toolAdapter?.mcpServers,
          canUseTool: toolAdapter?.canUseTool,
          settingSources: toolAdapter?.settingSources ?? [],
          systemPromptPreset: {
            preset: "claude_code",
            append:
              "You are being evaluated. Do not edit repository files. Complete the browser task and emit the requested EVAL_RESULT line.",
          },
        },
        onToolResult: toolAdapter?.onToolResult,
      });
      const { resultMessage, tokenUsage } = sessionResult;
      const reportedCost = resultMessage?.total_cost_usd;
      const numericCost =
        typeof reportedCost === "number"
          ? reportedCost
          : typeof reportedCost === "string" && reportedCost.trim()
            ? Number(reportedCost)
            : undefined;
      return {
        raw: sessionResult,
        resultText: sessionResult.resultText,
        transcriptText: buildClaudeCodeTranscript(sessionResult.messages),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason: sessionResult.stopReason,
        usage: {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          cachedInputTokens: tokenUsage.cacheReadInputTokens,
          cacheCreationInputTokens: tokenUsage.cacheCreationInputTokens,
          totalTokens: tokenUsage.totalTokens,
        },
        ...(numericCost !== undefined && Number.isFinite(numericCost) && { costUsd: numericCost }),
        metrics: buildClaudeCodeMetrics(resultMessage),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      claudeCodeAdapter.fromHarnessResult(
        {
          messages: raw.messages,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.resultText,
          status,
          usage: {
            input_tokens: raw.tokenUsage.inputTokens,
            output_tokens: raw.tokenUsage.outputTokens,
            cached_input_tokens: raw.tokenUsage.cacheReadInputTokens,
          },
        },
        taskSpec,
      ),
  });
}

function buildClaudeCodeMetrics(
  resultMessage: ClaudeSdkMessage | undefined,
): Record<string, MetricValue> {
  const tokenUsage = extractClaudeCodeTokenUsage(resultMessage);
  return {
    claude_code_turns: metricValue(resultMessage?.num_turns),
    claude_code_duration_ms: metricValue(resultMessage?.duration_ms),
    claude_code_cost_usd: metricValue(resultMessage?.total_cost_usd),
    claude_code_input_tokens: metricValue(tokenUsage.inputTokens),
    claude_code_output_tokens: metricValue(tokenUsage.outputTokens),
    claude_code_cache_creation_input_tokens: metricValue(tokenUsage.cacheCreationInputTokens),
    claude_code_cache_read_input_tokens: metricValue(tokenUsage.cacheReadInputTokens),
    claude_code_total_tokens: metricValue(tokenUsage.totalTokens),
  };
}

function readCsvEnv(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
