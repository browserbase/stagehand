import {
  buildCodexTranscript,
  loadCodexSdk,
  normalizeCodexModel,
  runCodexSession,
  stringifyError,
  toFiniteNumber,
  validateCodexApprovalPolicy,
  validateCodexSandboxMode,
  type CodexSdk,
  type CodexTokenUsage,
} from "@browserbasehq/stagehand-integrations-codex-sdk";
import type { AvailableModel } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { EvalLogger } from "../logger.js";
import type { PreparedCodexToolAdapter } from "./codexToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { codexAdapter } from "./harnesses/codexAdapter.js";
import {
  buildExternalHarnessPrompt,
  EVAL_RESULT_SCHEMA,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { CodexSdk, CodexThread } from "@browserbasehq/stagehand-integrations-codex-sdk";
export {
  buildCodexTranscript,
  loadCodexSdk,
  normalizeCodexModel,
  runCodexSession,
} from "@browserbasehq/stagehand-integrations-codex-sdk";
export { EVAL_RESULT_SCHEMA } from "./harnesses/externalRunner.js";

export interface CodexRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCodexToolAdapter;
  signal?: AbortSignal;
  sdk?: CodexSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedCodexResult extends ParsedEvalResult {}

export function buildCodexPrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export function parseCodexResult(raw: string): ParsedCodexResult {
  return parseEvalResult(raw);
}

export async function runCodexAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk,
  verifier,
}: CodexRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike | undefined = toolAdapter && {
    promptInstructions: toolAdapter.promptInstructions,
    captureEvidence: "captureEvidence" in toolAdapter ? toolAdapter.captureEvidence : undefined,
    drainStepObservations:
      "drainStepObservations" in toolAdapter ? toolAdapter.drainStepObservations : undefined,
    observedToolMatcher:
      "observedToolMatcher" in toolAdapter ? toolAdapter.observedToolMatcher : undefined,
  };
  return runExternalHarnessTask({
    harness: "codex",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "Codex did not report success",
    runSession: async (prompt) => {
      const sessionResult = await runCodexSession({
        prompt,
        model,
        logger,
        sdk:
          sdk ??
          (await loadEvalCodexSdk(
            toolAdapter?.env,
            toolAdapter && "codexConfig" in toolAdapter ? toolAdapter.codexConfig : undefined,
          )),
        signal,
        thread: {
          ...(toolAdapter?.cwd && { workingDirectory: toolAdapter.cwd }),
          sandboxMode: validateCodexSandboxMode(process.env.EVAL_CODEX_SANDBOX_MODE),
          approvalPolicy: validateCodexApprovalPolicy(process.env.EVAL_CODEX_APPROVAL_POLICY),
          networkAccessEnabled: readBooleanEnv("EVAL_CODEX_NETWORK_ACCESS", true),
          webSearchMode: "disabled",
          skipGitRepoCheck: true,
        },
        outputSchema: EVAL_RESULT_SCHEMA,
        maxToolSteps: readCodexMaxToolSteps(),
        onToolStep:
          toolAdapter && "recordObservation" in toolAdapter
            ? toolAdapter.recordObservation
            : undefined,
      });
      const usage = normalizeCodexUsage(sessionResult.tokenUsage);
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildCodexTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? sanitizeErrorMessage(stringifyError(sessionResult.iterationError)) || undefined
            : undefined),
        usage,
        metrics: buildCodexMetrics(sessionResult.tokenUsage),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      codexAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.input_tokens,
            output_tokens: raw.tokenUsage.output_tokens,
            // Unreported usage stays absent so trajectory consumers can
            // distinguish "not measured" from a measured zero.
            ...(raw.tokenUsage.reasoning_output_tokens !== undefined && {
              reasoning_tokens: raw.tokenUsage.reasoning_output_tokens,
            }),
            ...(raw.tokenUsage.cached_input_tokens !== undefined && {
              cached_input_tokens: raw.tokenUsage.cached_input_tokens,
            }),
          },
        },
        taskSpec,
      ),
  });
}

async function loadEvalCodexSdk(
  env?: Record<string, string>,
  extraConfig?: Record<string, unknown>,
): Promise<CodexSdk> {
  return loadCodexSdk({
    env,
    codexPathOverride: process.env.EVAL_CODEX_PATH,
    baseUrl: process.env.EVAL_CODEX_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    rawReasoning: process.env.EVAL_CODEX_RAW_REASONING === "true",
    extraConfig,
  });
}

function readCodexMaxToolSteps(): number {
  for (const key of ["EVAL_CODEX_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Codex budgets individual tool steps while Claude budgets turns (which can
  // span several tool calls); 100 steps ≈ 50 Claude turns keeps the harnesses
  // roughly comparable.
  return 100;
}

function readBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

function normalizeCodexUsage(usage: CodexTokenUsage) {
  const inputTokens = toFiniteNumber(usage.input_tokens);
  const cachedInputTokens = toFiniteNumber(usage.cached_input_tokens);
  const outputTokens = toFiniteNumber(usage.output_tokens);
  const reasoningOutputTokens = toFiniteNumber(usage.reasoning_output_tokens);
  // OpenAI reports cached_input as a subset of input and reasoning_output as a
  // subset of output. Anthropic reports cache creation/read outside input_tokens,
  // which is why extractClaudeCodeTokenUsage adds those cache fields instead.
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function buildCodexMetrics(usage: CodexTokenUsage): Record<string, MetricValue> {
  const normalized = normalizeCodexUsage(usage);
  return {
    codex_input_tokens: metricValue(normalized.inputTokens),
    codex_cached_input_tokens: metricValue(normalized.cachedInputTokens),
    codex_output_tokens: metricValue(normalized.outputTokens),
    codex_reasoning_output_tokens: metricValue(normalized.reasoningOutputTokens),
    codex_total_tokens: metricValue(normalized.totalTokens),
  };
}
