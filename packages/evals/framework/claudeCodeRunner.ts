import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";

type ClaudeSdkMessage = Record<string, unknown>;
type ClaudeQuery = AsyncIterable<ClaudeSdkMessage>;
type MetricValue = { count: number; value: number };

export type ClaudeAgentSdk = {
  query: (input: {
    prompt: string;
    options?: Record<string, unknown>;
  }) => ClaudeQuery;
};

export interface ClaudeCodeRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedClaudeCodeToolAdapter;
  signal?: AbortSignal;
  sdk?: ClaudeAgentSdk;
}

export interface ParsedClaudeCodeResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

const CLAUDE_AGENT_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

export function normalizeClaudeCodeModel(model: AvailableModel): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
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
    toolInstructions ??
      "Use the available browser/web tools to complete the task.",
    "At the end, print exactly one line beginning with EVAL_RESULT: followed by compact JSON.",
    'The JSON schema is: {"success": boolean, "summary": string, "finalAnswer": string}.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseClaudeCodeResult(raw: string): ParsedClaudeCodeResult {
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
      : [raw.trim()];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseClaudeCodeJson(candidate);
    if (parsed) {
      return {
        ...parsed,
        raw,
      };
    }
  }

  return { success: false, raw };
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
      finalAnswer:
        typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
    };
  } catch {
    return undefined;
  }
}

export function isClaudeCodeMaxTurnsError(value: unknown): boolean {
  const message = stringifyError(value);
  return /(?:maximum number of turns|max(?:imum)? turns|turn limit)/i.test(
    message,
  );
}

export async function runClaudeCodeAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk: injectedSdk,
}: ClaudeCodeRunnerInput): Promise<TaskResult> {
  const sdk = injectedSdk ?? (await loadClaudeAgentSdk());
  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) abortController.abort(signal.reason);
    signal.addEventListener(
      "abort",
      () => abortController.abort(signal.reason),
      { once: true },
    );
  }

  const messages: ClaudeSdkMessage[] = [];
  const prompt = buildClaudeCodePrompt(plan, toolAdapter?.promptInstructions);
  const allowedTools =
    toolAdapter?.allowedTools ??
    readCsvEnv("EVAL_CLAUDE_CODE_ALLOWED_TOOLS", ["WebFetch", "WebSearch"]);
  const permissionMode =
    process.env.EVAL_CLAUDE_CODE_PERMISSION_MODE ?? "default";
  const maxTurns = readPositiveIntEnv("EVAL_CLAUDE_CODE_MAX_TURNS", 50);
  const pathToClaudeCodeExecutable =
    process.env.EVAL_CLAUDE_CODE_EXECUTABLE || undefined;

  let resultText = "";
  let resultMessage: ClaudeSdkMessage | undefined;
  let iterationError: unknown;

  try {
    for await (const message of sdk.query({
      prompt,
      options: {
        abortController,
        allowedTools,
        ...(toolAdapter?.canUseTool && {
          canUseTool: toolAdapter.canUseTool,
        }),
        ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
        ...(toolAdapter?.env && { env: toolAdapter.env }),
        maxTurns,
        ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
        model: normalizeClaudeCodeModel(model),
        pathToClaudeCodeExecutable,
        permissionMode,
        settingSources: toolAdapter?.settingSources ?? [],
        stderr: (data: string) => {
          logger.log({
            category: "claude_code",
            message: data,
            level: 1,
          });
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "You are being evaluated. Do not edit repository files. Complete the browser task and emit the requested EVAL_RESULT line.",
        },
      },
    })) {
      messages.push(message);
      logClaudeCodeMessage(logger, message);
      if (message.type === "result") {
        resultMessage = message;
        if (typeof message.result === "string") {
          resultText = message.result;
        } else if (Array.isArray(message.errors)) {
          resultText = message.errors.join("\n");
        }
      }
    }
  } catch (error) {
    iterationError = error;
    logger.warn({
      category: "claude_code",
      message: `Claude Code stopped before a normal result: ${stringifyError(error)}`,
      level: 0,
      auxiliary: {
        error: {
          value: stringifyError(error),
          type: "string",
        },
      },
    });
  }

  const transcriptText = buildClaudeCodeTranscript(messages);
  const rawResult = [resultText, transcriptText, stringifyError(iterationError)]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseClaudeCodeResult(rawResult);
  const status = resolveClaudeCodeStatus(resultMessage, iterationError);
  const stopReason = buildClaudeCodeStopReason(resultMessage, iterationError);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (resultText || transcriptText || "Claude Code did not report success");

  return {
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
    claude_code_cache_creation_input_tokens: metricValue(
      tokenUsage.cacheCreationInputTokens,
    ),
    claude_code_cache_read_input_tokens: metricValue(
      tokenUsage.cacheReadInputTokens,
    ),
    claude_code_total_tokens: metricValue(tokenUsage.totalTokens),
  };
}

function extractClaudeCodeTokenUsage(
  resultMessage: ClaudeSdkMessage | undefined,
): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
} {
  const usage = isRecord(resultMessage?.usage)
    ? resultMessage.usage
    : undefined;

  const inputTokens =
    readNumber(usage, "input_tokens") ??
    sumModelUsage(resultMessage, "inputTokens");
  const outputTokens =
    readNumber(usage, "output_tokens") ??
    sumModelUsage(resultMessage, "outputTokens");
  const cacheCreationInputTokens =
    readNumber(usage, "cache_creation_input_tokens") ??
    sumModelUsage(resultMessage, "cacheCreationInputTokens");
  const cacheReadInputTokens =
    readNumber(usage, "cache_read_input_tokens") ??
    sumModelUsage(resultMessage, "cacheReadInputTokens");
  const totalTokens =
    inputTokens +
    outputTokens +
    cacheCreationInputTokens +
    cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
  };
}

function sumModelUsage(
  resultMessage: ClaudeSdkMessage | undefined,
  key: string,
): number {
  if (!isRecord(resultMessage?.modelUsage)) return 0;

  let total = 0;
  for (const usage of Object.values(resultMessage.modelUsage)) {
    if (!isRecord(usage)) continue;
    total += readNumber(usage, key) ?? 0;
  }
  return total;
}

function metricValue(value: unknown): MetricValue {
  return {
    count: 1,
    value: toFiniteNumber(value),
  };
}

function readNumber(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!record || !(key in record)) return undefined;
  return toFiniteNumber(record[key]);
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

function resolveClaudeCodeStatus(
  resultMessage: ClaudeSdkMessage | undefined,
  iterationError: unknown,
): "completed" | "max_turns" | "sdk_error" {
  if (
    isClaudeCodeMaxTurnsError(iterationError) ||
    isClaudeCodeMaxTurnsError(resultMessage)
  ) {
    return "max_turns";
  }
  if (iterationError || resultMessage?.is_error === true) {
    return "sdk_error";
  }
  return "completed";
}

function buildClaudeCodeStopReason(
  resultMessage: ClaudeSdkMessage | undefined,
  iterationError: unknown,
): string | undefined {
  if (iterationError) return stringifyError(iterationError);
  if (resultMessage?.is_error === true) {
    const result = resultMessage.result;
    if (typeof result === "string" && result.trim()) return result.trim();
    const errors = resultMessage.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((error) => String(error)).join("\n");
    }
    return "Claude Code returned an error result";
  }
  return undefined;
}

function buildClaudeCodeTranscript(messages: ClaudeSdkMessage[]): string {
  return messages
    .map((message) => summarizeClaudeCodeMessage(message).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

function logClaudeCodeMessage(
  logger: EvalLogger,
  message: ClaudeSdkMessage,
): void {
  const summary = summarizeClaudeCodeMessage(message);
  logger.log({
    category: "claude_code",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: {
        value: String(message.type ?? "unknown"),
        type: "string",
      },
      ...(summary.detail && {
        detail: {
          value: summary.detail,
          type: "string",
        },
      }),
    },
  });
}

function summarizeClaudeCodeMessage(message: ClaudeSdkMessage): {
  message: string;
  detail?: string;
} {
  const type = String(message.type ?? "unknown");
  if (type === "assistant") {
    const text = extractText(message);
    return {
      message: text ? `assistant: ${clip(text, 500)}` : "assistant message",
      detail: text,
    };
  }
  if (type === "user") {
    const text = extractText(message);
    return {
      message: text ? `user/tool: ${clip(text, 500)}` : "user/tool message",
      detail: text,
    };
  }
  if (type === "result") {
    return {
      message: `result: ${String(message.subtype ?? "done")}`,
      detail: typeof message.result === "string" ? message.result : undefined,
    };
  }
  return {
    message: `${type} message`,
    detail: safeJson(message),
  };
}

function extractText(message: ClaudeSdkMessage): string | undefined {
  const content = message.message;
  if (!isRecord(content)) return undefined;
  const rawContent = content.content;
  if (typeof rawContent === "string") return rawContent;
  if (!Array.isArray(rawContent)) return undefined;
  const parts: string[] = [];
  for (const block of rawContent) {
    if (!isRecord(block)) continue;
    if (typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }
    if (typeof block.name === "string") {
      parts.push(`[tool:${block.name}] ${safeJson(block.input) ?? ""}`.trim());
      continue;
    }
    if (typeof block.type === "string") {
      parts.push(`[${block.type}] ${safeJson(block) ?? ""}`.trim());
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeJson(value) ?? String(value);
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

async function loadClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  try {
    const specifier = CLAUDE_AGENT_SDK_PACKAGE;
    const mod = (await import(specifier)) as Partial<ClaudeAgentSdk>;
    if (typeof mod.query !== "function") {
      throw new Error("query export missing");
    }
    return { query: mod.query };
  } catch (error) {
    throw new EvalsError(
      `Claude Code harness requires ${CLAUDE_AGENT_SDK_PACKAGE}. Install it in packages/evals before running --harness claude_code. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
