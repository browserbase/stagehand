import {
  buildCodexTranscript,
  loadCodexSdk,
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
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { PreparedCodexToolAdapter } from "./codexToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { EVAL_SYSTEM_PROMPT } from "./evalSystemPrompt.js";
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
import { readReasoningSummary } from "./reasoningSummary.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { CodexSdk, CodexThread } from "@browserbasehq/stagehand-integrations-codex-sdk";
export {
  buildCodexTranscript,
  loadCodexSdk,
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
    browserSessionLoss:
      "browserSessionLoss" in toolAdapter ? toolAdapter.browserSessionLoss : undefined,
  };
  // Codex budgets individual tool steps; 100 ≈ 50 Claude turns keeps the harnesses comparable.
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: "EVAL_CODEX_MAX_STEPS",
    dataset: plan.dataset,
    harnessDefault: 100,
  });
  return runExternalHarnessTask({
    harness: "codex",
    plan,
    model,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "Codex did not report success",
    stepBudget: maxToolSteps,
    stepBudgetUnit: "tool_calls",
    configuration: {
      requestedReasoningEffort: validateCodexReasoningEffort(
        process.env.EVAL_CODEX_REASONING_EFFORT,
      ),
      requestedReasoningSummary: readReasoningSummary() ?? "off",
    },
    // A caller-owned SDK is already constructed, so its developer config
    // cannot be extended here. Use the shared fallback for that path.
    systemPromptMode: sdk ? "task_prefix" : "native",
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
          ...(validateCodexReasoningEffort(process.env.EVAL_CODEX_REASONING_EFFORT) && {
            modelReasoningEffort: validateCodexReasoningEffort(
              process.env.EVAL_CODEX_REASONING_EFFORT,
            ),
          }),
        },
        outputSchema: EVAL_RESULT_SCHEMA,
        maxToolSteps,
        ...(toolAdapter?.env?.CODEX_HOME && { codexHome: toolAdapter.env.CODEX_HOME }),
        onToolStep:
          toolAdapter && "recordObservation" in toolAdapter
            ? toolAdapter.recordObservation
            : undefined,
      });
      const usage = {
        ...normalizeCodexUsage(sessionResult.tokenUsage),
        // Zeros after an aborted turn with no rollout are unknown usage, not a free run.
        reported: sessionResult.usageSource !== "none",
      };
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
        metrics: {
          ...buildCodexMetrics(sessionResult.tokenUsage),
          // 1 when the turn never completed and usage came from the rollout file.
          codex_usage_recovered: metricValue(sessionResult.usageSource === "rollout" ? 1 : 0),
        },
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

/**
 * Codex config overrides for an eval session. Codex requests no reasoning
 * summaries for models outside its own catalog, so reasoning items never
 * arrive unless `model_reasoning_summary` is set explicitly.
 */
const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
] as const;

/** Validate EVAL_CODEX_REASONING_EFFORT; undefined leaves the codex per-model default. */
export function validateCodexReasoningEffort(
  raw: string | undefined,
): (typeof CODEX_REASONING_EFFORTS)[number] | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if ((CODEX_REASONING_EFFORTS as readonly string[]).includes(v)) {
    return v as (typeof CODEX_REASONING_EFFORTS)[number];
  }
  throw new EvalsError(
    `EVAL_CODEX_REASONING_EFFORT must be one of ${CODEX_REASONING_EFFORTS.join(", ")}.`,
  );
}

export function buildEvalCodexConfig(
  extraConfig?: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const reasoningSummary = readReasoningSummary(env);
  const reasoningEffort = validateCodexReasoningEffort(env.EVAL_CODEX_REASONING_EFFORT);
  const configuredInstructions = extraConfig?.developer_instructions;
  if (configuredInstructions !== undefined && typeof configuredInstructions !== "string") {
    throw new EvalsError("Codex developer_instructions must be a string.");
  }
  const developerInstructions =
    typeof configuredInstructions === "string" ? configuredInstructions : "";
  return {
    ...(reasoningSummary && { model_reasoning_summary: reasoningSummary }),
    ...(reasoningEffort && { model_reasoning_effort: reasoningEffort }),
    ...extraConfig,
    developer_instructions: developerInstructions?.includes(EVAL_SYSTEM_PROMPT)
      ? developerInstructions
      : [developerInstructions, EVAL_SYSTEM_PROMPT].filter(Boolean).join("\n\n"),
  };
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
    extraConfig: buildEvalCodexConfig(extraConfig),
  });
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
