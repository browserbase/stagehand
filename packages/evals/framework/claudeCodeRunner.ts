import {
  buildClaudeCodeTranscript,
  extractClaudeCodeTokenUsage,
  normalizeClaudeModel,
  runClaudeAgentSession,
  stringifyError,
  type ClaudeAgentSdk,
  type ClaudeSdkMessage,
} from "@browserbasehq/stagehand-integrations-claude-agent-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { datasetPromptGuidance } from "./externalHarnessPlan.js";
import type { PreparedClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";
import { claudeCodeAdapter } from "./harnesses/claudeCodeAdapter.js";
import type { TaskResult } from "./types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { ClaudeAgentSdk };
export { isClaudeCodeMaxTurnsError } from "@browserbasehq/stagehand-integrations-claude-agent-sdk";

type MetricValue = { count: number; value: number };

export interface ClaudeCodeRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedClaudeCodeToolAdapter;
  signal?: AbortSignal;
  sdk?: ClaudeAgentSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedClaudeCodeResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

export function normalizeClaudeCodeModel(model: AvailableModel): string {
  return normalizeClaudeModel(model);
}

export function buildClaudeCodePrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
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
    "At the end, print exactly one line beginning with EVAL_RESULT: followed by compact JSON.",
    'The JSON schema is: {"success": boolean, "summary": string, "finalAnswer": string}.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseClaudeCodeResult(raw: string): ParsedClaudeCodeResult {
  const marker = "EVAL_RESULT:";
  const markerIndex = raw.lastIndexOf(marker);
  const resultText = markerIndex >= 0 ? raw.slice(markerIndex + marker.length).trim() : raw.trim();
  const candidates =
    markerIndex >= 0
      ? [resultText, resultText.split(/\r?\n/, 1)[0]?.trim(), extractFirstJsonObject(resultText)]
      : [resultText];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseClaudeCodeJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

function tryParseClaudeCodeJson(
  candidate: string,
): Omit<ParsedClaudeCodeResult, "raw"> | undefined {
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

export async function runClaudeCodeAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk,
  verifier,
}: ClaudeCodeRunnerInput): Promise<TaskResult> {
  const prompt = buildClaudeCodePrompt(plan, toolAdapter?.promptInstructions);
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
  const { messages, resultMessage, resultText, iterationError, status, stopReason, tokenUsage } =
    sessionResult;
  const transcriptText = buildClaudeCodeTranscript(messages);
  const rawResult = [resultText, transcriptText, stringifyError(iterationError)]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseClaudeCodeResult(rawResult);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (resultText || transcriptText || "Claude Code did not report success");
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    claudeCodeStatus: status,
    ...(stopReason && { claudeCodeStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildClaudeCodeMetrics(resultMessage),
  };
  if (!verifier) return baseResult;

  const finalObservation = await toolAdapter?.captureEvidence?.().catch((): undefined => undefined);
  const stepObservations = await toolAdapter?.drainStepObservations?.();
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      claudeCodeAdapter.fromHarnessResult(
        {
          messages,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter?.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          finalAnswer: parsed.finalAnswer ?? resultText,
          status: status === "completed" ? "complete" : "error",
          usage: {
            input_tokens: tokenUsage.inputTokens,
            output_tokens: tokenUsage.outputTokens,
            cached_input_tokens: tokenUsage.cacheReadInputTokens,
          },
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: "claude_code",
    logger,
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

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}

function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
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
