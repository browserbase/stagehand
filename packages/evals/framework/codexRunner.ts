import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedCodexToolAdapter } from "./codexToolAdapter.js";

type MetricValue = { count: number; value: number };
type CodexEvent = Record<string, unknown>;
type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

export type CodexThread = {
  runStreamed: (
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<{ events: AsyncIterable<CodexEvent> }>;
};

export type CodexSdk = {
  startThread: (options?: Record<string, unknown>) => CodexThread;
};

export interface CodexRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedCodexToolAdapter;
  signal?: AbortSignal;
  sdk?: CodexSdk;
}

export interface ParsedCodexResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

const CODEX_SDK_PACKAGE = "@openai/codex-sdk";

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

export function normalizeCodexModel(model: AvailableModel): string {
  if (model === ("codex/default" as AvailableModel)) return "gpt-5.4-mini";
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function buildCodexPrompt(
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
  sdk: injectedSdk,
}: CodexRunnerInput): Promise<TaskResult> {
  const sdk = injectedSdk ?? (await loadCodexSdk(toolAdapter?.env));
  const prompt = buildCodexPrompt(plan, toolAdapter?.promptInstructions);
  const events: CodexEvent[] = [];
  let finalResponse = "";
  let usage: CodexUsage | undefined;
  let iterationError: unknown;
  let stopReason: string | undefined;

  try {
    const thread = sdk.startThread({
      model: normalizeCodexModel(model),
      ...(toolAdapter?.cwd && {
        workingDirectory: toolAdapter.cwd,
        skipGitRepoCheck: true,
      }),
      sandboxMode: readCodexSandboxMode(),
      approvalPolicy: readCodexApprovalPolicy(),
      networkAccessEnabled: readBooleanEnv("EVAL_CODEX_NETWORK_ACCESS", true),
      webSearchMode: "disabled",
    });
    const streamed = await thread.runStreamed(prompt, {
      outputSchema: EVAL_RESULT_SCHEMA,
      ...(signal && { signal }),
    });

    for await (const event of streamed.events) {
      events.push(event);
      logCodexEvent(logger, event);

      if (event.type === "turn.completed" && isRecord(event.usage)) {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        stopReason = readCodexErrorMessage(event.error);
      } else if (event.type === "error") {
        stopReason =
          typeof event.message === "string" ? event.message : "error";
      }

      const item = isRecord(event.item) ? event.item : undefined;
      if (
        event.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        finalResponse = item.text;
      }
    }
  } catch (error) {
    iterationError = error;
    logger.warn({
      category: "codex",
      message: `Codex stopped before a normal result: ${stringifyError(error)}`,
      level: 0,
      auxiliary: {
        error: {
          value: stringifyError(error),
          type: "string",
        },
      },
    });
  }

  const transcriptText = buildCodexTranscript(events);
  const iterationErrorMessage = stringifyError(iterationError);
  const rawResult = [finalResponse, transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const parsed = parseCodexResult(rawResult);
  const status = resolveCodexStatus(iterationError, stopReason);
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (iterationErrorMessage ||
      finalResponse ||
      transcriptText ||
      "Codex did not report success");

  return {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    codexStatus: status,
    ...(stopReason && { codexStopReason: stopReason }),
    logs: logger.getLogs(),
    metrics: buildCodexMetrics(usage),
  };
}

function tryParseCodexJson(
  candidate: string,
): Omit<ParsedCodexResult, "raw"> | undefined {
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

function resolveCodexStatus(
  iterationError: unknown,
  stopReason: string | undefined,
): "completed" | "sdk_error" {
  return iterationError || stopReason ? "sdk_error" : "completed";
}

function buildCodexMetrics(
  usage: CodexUsage | undefined,
): Record<string, MetricValue> {
  const inputTokens = toFiniteNumber(usage?.input_tokens);
  const cachedInputTokens = toFiniteNumber(usage?.cached_input_tokens);
  const outputTokens = toFiniteNumber(usage?.output_tokens);
  const reasoningOutputTokens = toFiniteNumber(usage?.reasoning_output_tokens);

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
  return {
    count: 1,
    value: toFiniteNumber(value),
  };
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

function buildCodexTranscript(events: CodexEvent[]): string {
  return events
    .map((event) => summarizeCodexEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

function logCodexEvent(logger: EvalLogger, event: CodexEvent): void {
  const summary = summarizeCodexEvent(event);
  logger.log({
    category: "codex",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: {
        value: String(event.type ?? "unknown"),
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

function summarizeCodexEvent(event: CodexEvent): {
  message: string;
  detail?: string;
} {
  const type = String(event.type ?? "unknown");
  const item = isRecord(event.item) ? event.item : undefined;
  if (item?.type === "agent_message" && typeof item.text === "string") {
    return {
      message: `agent: ${clip(item.text, 500)}`,
      detail: item.text,
    };
  }
  if (item?.type === "command_execution") {
    return {
      message:
        `command: ${String(item.command ?? "")} ${String(item.status ?? "")}`.trim(),
      detail: safeJson(item),
    };
  }
  if (item?.type === "mcp_tool_call") {
    return {
      message:
        `mcp: ${String(item.server ?? "")}.${String(item.tool ?? "")} ${String(item.status ?? "")}`.trim(),
      detail: safeJson(item),
    };
  }
  if (item?.type === "error" && typeof item.message === "string") {
    return {
      message: `error item: ${clip(item.message, 500)}`,
      detail: item.message,
    };
  }
  if (type === "turn.completed") {
    return {
      message: "turn completed",
      detail: safeJson(event.usage),
    };
  }
  if (type === "turn.failed") {
    const message = readCodexErrorMessage(event.error) ?? "turn failed";
    return {
      message: `turn failed: ${clip(message, 500)}`,
      detail: message,
    };
  }
  if (type === "error" && typeof event.message === "string") {
    return {
      message: `error: ${clip(event.message, 500)}`,
      detail: event.message,
    };
  }
  return {
    message: `${type} event`,
    detail: safeJson(event),
  };
}

async function loadCodexSdk(env?: Record<string, string>): Promise<CodexSdk> {
  try {
    const specifier = CODEX_SDK_PACKAGE;
    const mod = (await import(specifier)) as {
      Codex?: new (options?: Record<string, unknown>) => CodexSdk;
    };
    if (typeof mod.Codex !== "function") {
      throw new Error("Codex export missing");
    }
    return new mod.Codex({
      ...(env && { env }),
      ...(process.env.EVAL_CODEX_PATH && {
        codexPathOverride: process.env.EVAL_CODEX_PATH,
      }),
      ...(process.env.EVAL_CODEX_BASE_URL && {
        baseUrl: process.env.EVAL_CODEX_BASE_URL,
      }),
      ...(process.env.OPENAI_API_KEY && {
        apiKey: process.env.OPENAI_API_KEY,
      }),
      config: {
        show_raw_agent_reasoning:
          process.env.EVAL_CODEX_RAW_REASONING === "true",
      },
    });
  } catch (error) {
    throw new EvalsError(
      `Codex harness requires ${CODEX_SDK_PACKAGE}. Install it in packages/evals before running --harness codex. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readCodexSandboxMode():
  | "read-only"
  | "workspace-write"
  | "danger-full-access" {
  const raw = process.env.EVAL_CODEX_SANDBOX_MODE;
  if (
    raw === "read-only" ||
    raw === "workspace-write" ||
    raw === "danger-full-access"
  ) {
    return raw;
  }
  return "workspace-write";
}

function readCodexApprovalPolicy():
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted" {
  const raw = process.env.EVAL_CODEX_APPROVAL_POLICY;
  if (
    raw === "never" ||
    raw === "on-request" ||
    raw === "on-failure" ||
    raw === "untrusted"
  ) {
    return raw;
  }
  return "never";
}

function readBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

function readCodexErrorMessage(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return safeJson(value);
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
