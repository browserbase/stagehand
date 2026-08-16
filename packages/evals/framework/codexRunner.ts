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
import type { EvalLogger } from "../logger.js";
import type { PreparedCodexToolAdapter } from "./codexToolAdapter.js";
import { datasetPromptGuidance, type ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { codexAdapter } from "./harnesses/codexAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { CodexSdk, CodexThread } from "@browserbasehq/stagehand-integrations-codex-sdk";
export {
  buildCodexTranscript,
  loadCodexSdk,
  normalizeCodexModel,
  runCodexSession,
} from "@browserbasehq/stagehand-integrations-codex-sdk";

type MetricValue = { count: number; value: number };

export interface CodexRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCodexToolAdapter;
  signal?: AbortSignal;
  sdk?: CodexSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedCodexResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

const EVAL_RESULT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    summary: { type: "string" },
    finalAnswer: { type: "string" },
  },
  required: ["success", "summary", "finalAnswer"],
  additionalProperties: false,
} as const;

export function buildCodexPrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
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
    "Do not edit repository files.",
    "At the end, return compact JSON matching this schema:",
    '{"success": boolean, "summary": string, "finalAnswer": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCodexResult(raw: string): ParsedCodexResult {
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
    const parsed = tryParseCodexJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
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
  const prompt = buildCodexPrompt(plan, toolAdapter?.promptInstructions);
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
      toolAdapter && "recordObservation" in toolAdapter ? toolAdapter.recordObservation : undefined,
  });
  const { events, finalMessage, iterationError, status, stopReason, tokenUsage } = sessionResult;
  const transcriptText = buildCodexTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [finalMessage, transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseCodexResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage || finalMessage || transcriptText || "Codex did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    codexStatus: status,
    ...(stopReason && { codexStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildCodexMetrics(tokenUsage),
  };
  if (!verifier) return baseResult;

  const finalObservation =
    toolAdapter && "captureEvidence" in toolAdapter
      ? await toolAdapter.captureEvidence?.().catch((): undefined => undefined)
      : undefined;
  const stepObservations =
    toolAdapter && "drainStepObservations" in toolAdapter
      ? await toolAdapter.drainStepObservations?.()
      : undefined;
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      codexAdapter.fromHarnessResult(
        {
          events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter &&
            "observedToolMatcher" in toolAdapter &&
            toolAdapter.observedToolMatcher && {
              observedToolName: toolAdapter.observedToolMatcher,
            }),
          finalAnswer: parsed.finalAnswer ?? finalMessage,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: tokenUsage.input_tokens,
            output_tokens: tokenUsage.output_tokens,
            reasoning_tokens: tokenUsage.reasoning_output_tokens,
            cached_input_tokens: tokenUsage.cached_input_tokens,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "codex",
    logger,
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
  return 50;
}

function readBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

function tryParseCodexJson(candidate: string): Omit<ParsedCodexResult, "raw"> | undefined {
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

function buildCodexMetrics(usage: CodexTokenUsage): Record<string, MetricValue> {
  const inputTokens = toFiniteNumber(usage.input_tokens);
  const cachedInputTokens = toFiniteNumber(usage.cached_input_tokens);
  const outputTokens = toFiniteNumber(usage.output_tokens);
  const reasoningOutputTokens = toFiniteNumber(usage.reasoning_output_tokens);
  return {
    codex_input_tokens: metricValue(inputTokens),
    codex_cached_input_tokens: metricValue(cachedInputTokens),
    codex_output_tokens: metricValue(outputTokens),
    codex_reasoning_output_tokens: metricValue(reasoningOutputTokens),
    codex_total_tokens: metricValue(
      inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens,
    ),
  };
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}
