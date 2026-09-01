import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  HarnessAdapterError,
  harnessEventLogLevel,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type CodexEvent = Record<string, unknown>;

export type CodexThread = {
  runStreamed: (
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<{ events: AsyncIterable<CodexEvent> }>;
};

export type CodexSdk = {
  startThread: (options?: Record<string, unknown>) => CodexThread;
};

export type CodexThreadConfig = {
  workingDirectory?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  skipGitRepoCheck?: boolean;
};

export type CodexTokenUsage = {
  input_tokens: number;
  /** Absent when the SDK did not report it — never synthesized as 0. */
  cached_input_tokens?: number;
  output_tokens: number;
  /** Absent when the SDK did not report it — never synthesized as 0. */
  reasoning_output_tokens?: number;
};

/**
 * Where the session's token usage came from: the `turn.completed` event, the
 * thread's rollout file under CODEX_HOME (when the turn was aborted before it
 * completed), or nowhere (all-zero usage that must not be trusted).
 */
export type CodexUsageSource = "turn_completed" | "rollout" | "none";

export type CodexSessionResult = {
  events: CodexEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: CodexTokenUsage;
  usageSource: CodexUsageSource;
  threadId?: string;
  iterationError?: unknown;
};

export const CODEX_SDK_PACKAGE = "@openai/codex-sdk";

export async function loadCodexSdk(
  options: {
    env?: Record<string, string>;
    codexPathOverride?: string;
    baseUrl?: string;
    apiKey?: string;
    rawReasoning?: boolean;
    extraConfig?: Record<string, unknown>;
  } = {},
): Promise<CodexSdk> {
  let codexCtor: new (options?: Record<string, unknown>) => CodexSdk;
  try {
    const specifier = CODEX_SDK_PACKAGE;
    const mod = (await import(specifier)) as {
      Codex?: new (options?: Record<string, unknown>) => CodexSdk;
    };
    if (typeof mod.Codex !== "function") throw new Error("Codex export missing");
    codexCtor = mod.Codex;
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Codex SDK harness requires ${CODEX_SDK_PACKAGE}. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
  // Construction failures are auth/config problems, not missing installs.
  try {
    return new codexCtor({
      ...(options.env && { env: options.env }),
      ...(options.codexPathOverride && { codexPathOverride: options.codexPathOverride }),
      ...(options.baseUrl && { baseUrl: options.baseUrl }),
      ...(options.apiKey && { apiKey: options.apiKey }),
      config: {
        show_raw_agent_reasoning: options.rawReasoning === true,
        ...options.extraConfig,
      },
    });
  } catch (error) {
    throw new HarnessAdapterError(
      `Failed to initialize the Codex SDK: ${sanitizeErrorMessage(stringifyError(error))}`,
      { cause: error },
    );
  }
}

export function normalizeCodexModel(model: string): string {
  if (model === "codex/default") return "gpt-5.4-mini";
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function validateCodexSandboxMode(
  value: unknown,
): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  // Fail closed: an unset or unrecognized mode must not grant disk writes.
  return "read-only";
}

export function validateCodexApprovalPolicy(
  value: unknown,
): "never" | "on-request" | "on-failure" | "untrusted" {
  if (
    value === "never" ||
    value === "on-request" ||
    value === "on-failure" ||
    value === "untrusted"
  ) {
    return value;
  }
  return "never";
}

export async function runCodexSession(input: {
  prompt: string;
  model: string;
  sdk?: CodexSdk;
  signal?: AbortSignal;
  logger: HarnessLogger;
  thread: CodexThreadConfig;
  outputSchema?: Record<string, unknown>;
  maxToolSteps?: number;
  onToolStep?: () => void | Promise<void>;
  /**
   * CODEX_HOME the binary runs with. `codex exec` only reports usage on
   * `turn.completed`, which never arrives when the turn is aborted (step
   * budget, caller signal); the cumulative count is then read back from the
   * thread's rollout file under this directory.
   */
  codexHome?: string;
}): Promise<CodexSessionResult> {
  const sdk = input.sdk ?? (await loadCodexSdk());
  const events: CodexEvent[] = [];
  let finalMessage = "";
  let stopReason: string | undefined;
  let iterationError: unknown;
  let tokenUsage = emptyTokenUsage();
  let usageSource: CodexUsageSource = "none";
  let threadId: string | undefined;
  const maxToolSteps = positiveInteger(input.maxToolSteps, 100);
  const budgetController = new AbortController();
  const forwardAbort = () => budgetController.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) budgetController.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  let toolStepCount = 0;
  let budgetExhausted = false;

  try {
    const thread = sdk.startThread({
      ...(input.model && { model: normalizeCodexModel(input.model) }),
      ...(input.thread.workingDirectory && {
        workingDirectory: input.thread.workingDirectory,
      }),
      sandboxMode: validateCodexSandboxMode(input.thread.sandboxMode),
      approvalPolicy: validateCodexApprovalPolicy(input.thread.approvalPolicy),
      networkAccessEnabled: input.thread.networkAccessEnabled ?? true,
      webSearchMode: input.thread.webSearchMode ?? "disabled",
      skipGitRepoCheck: input.thread.skipGitRepoCheck ?? true,
    });
    const streamed = await thread.runStreamed(input.prompt, {
      ...(input.outputSchema && { outputSchema: input.outputSchema }),
      signal: budgetController.signal,
    });

    for await (const event of streamed.events) {
      events.push(event);
      logCodexEvent(input.logger, event);
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
      } else if (event.type === "turn.completed" && isRecord(event.usage)) {
        tokenUsage = extractCodexTokenUsage(event.usage);
        usageSource = "turn_completed";
      } else if (event.type === "turn.failed") {
        stopReason = readCodexErrorMessage(event.error);
      } else if (event.type === "error") {
        stopReason = typeof event.message === "string" ? event.message : "error";
      }

      const item = isRecord(event.item) ? event.item : undefined;
      if (
        event.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        finalMessage = item.text;
      }
      if (
        event.type === "item.completed" &&
        (item?.type === "command_execution" || item?.type === "mcp_tool_call")
      ) {
        toolStepCount += 1;
        if (toolStepCount >= maxToolSteps && !budgetController.signal.aborted) {
          stopReason = `tool step budget exhausted (${maxToolSteps} steps)`;
          budgetExhausted = true;
          budgetController.abort(new Error(stopReason));
        }
        if (item.type === "mcp_tool_call") await input.onToolStep?.();
      }
    }
  } catch (error) {
    iterationError = error;
    input.logger.warn({
      category: "codex",
      message: `Codex stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: { error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" } },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  if (usageSource === "none" && input.codexHome && threadId) {
    const recovered = await readCodexRolloutUsage(input.codexHome, threadId);
    if (recovered) {
      tokenUsage = recovered;
      usageSource = "rollout";
      input.logger.log({
        category: "codex",
        level: 1,
        message: `token usage recovered from rollout (turn never completed): in=${recovered.input_tokens} out=${recovered.output_tokens}`,
      });
    } else {
      input.logger.warn({
        category: "codex",
        level: 1,
        message: "token usage unavailable: turn never completed and no rollout token_count found",
      });
    }
  }

  return {
    events,
    finalMessage,
    status: resolveCodexStatus(iterationError, stopReason, budgetExhausted),
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    tokenUsage,
    usageSource,
    ...(threadId && { threadId }),
    ...(iterationError !== undefined && { iterationError }),
  };
}

/**
 * Cumulative usage of a thread from its rollout under
 * `<codexHome>/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl`.
 * Codex appends a `token_count` event after every model response, so the last
 * one on disk covers everything billed before the process was killed.
 */
export async function readCodexRolloutUsage(
  codexHome: string,
  threadId: string,
): Promise<CodexTokenUsage | undefined> {
  const rollout = await findCodexRollout(codexHome, threadId);
  if (!rollout) return undefined;
  try {
    return parseCodexRolloutUsage(await fsp.readFile(rollout, "utf8"));
  } catch {
    return undefined;
  }
}

async function findCodexRollout(codexHome: string, threadId: string): Promise<string | undefined> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const pending = [sessionsRoot];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name.startsWith("rollout-") && entry.name.endsWith(`-${threadId}.jsonl`)) {
        return full;
      }
    }
  }
  return undefined;
}

/** Last `token_count` total in a rollout JSONL body; undefined when there is none. */
export function parseCodexRolloutUsage(body: string): CodexTokenUsage | undefined {
  let latest: Record<string, unknown> | undefined;
  for (const line of body.split(/\r?\n/u)) {
    if (!line.includes('"token_count"')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const payload = isRecord(record.payload) ? record.payload : record;
    if (payload.type !== "token_count" || !isRecord(payload.info)) continue;
    const total = payload.info.total_token_usage;
    if (isRecord(total)) latest = total;
  }
  return latest ? extractCodexTokenUsage(latest) : undefined;
}

export function resolveCodexStatus(
  iterationError: unknown,
  stopReason?: string,
  budgetExhausted = false,
): "completed" | "max_turns" | "sdk_error" {
  // Tool-step budget exhaustion is the same class of stop as Claude's
  // max_turns, not an SDK failure; callers decide how to score it.
  if (budgetExhausted) return "max_turns";
  return iterationError || stopReason ? "sdk_error" : "completed";
}

export function extractCodexTokenUsage(
  usage: Record<string, unknown> | undefined,
): CodexTokenUsage {
  return {
    input_tokens: toFiniteNumber(usage?.input_tokens),
    output_tokens: toFiniteNumber(usage?.output_tokens),
    ...(usage?.cached_input_tokens !== undefined && {
      cached_input_tokens: toFiniteNumber(usage.cached_input_tokens),
    }),
    ...(usage?.reasoning_output_tokens !== undefined && {
      reasoning_output_tokens: toFiniteNumber(usage.reasoning_output_tokens),
    }),
  };
}

function emptyTokenUsage(): CodexTokenUsage {
  return extractCodexTokenUsage(undefined);
}

export function buildCodexTranscript(events: CodexEvent[]): string {
  return events
    .map((event) => summarizeCodexEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logCodexEvent(logger: HarnessLogger, event: CodexEvent): void {
  const type = String(event.type ?? "unknown");
  const item = isRecord(event.item) ? event.item : undefined;
  const level = harnessEventLogLevel(type, {
    isError:
      type === "turn.failed" ||
      type === "error" ||
      item?.type === "error" ||
      (type === "item.completed" && item?.status === "failed"),
    hasContent: type === "item.completed" || type === "turn.completed",
  });
  if (level === undefined) return;
  const summary = summarizeCodexEvent(event);
  logger.log({
    category: "codex",
    message: summary.message,
    level,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeCodexEvent(event: CodexEvent): { message: string; detail?: string } {
  const type = String(event.type ?? "unknown");
  const item = isRecord(event.item) ? event.item : undefined;
  if (item?.type === "agent_message" && typeof item.text === "string") {
    return { message: `agent: ${clip(item.text, 500)}`, detail: item.text };
  }
  if (item?.type === "command_execution") {
    return {
      message: `command: ${String(item.command ?? "")} ${String(item.status ?? "")}`.trim(),
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
    return { message: `error item: ${clip(item.message, 500)}`, detail: item.message };
  }
  if (type === "turn.completed")
    return { message: "turn completed", detail: safeJson(event.usage) };
  if (type === "turn.failed") {
    const message = readCodexErrorMessage(event.error) ?? "turn failed";
    return { message: `turn failed: ${clip(message, 500)}`, detail: message };
  }
  if (type === "error" && typeof event.message === "string") {
    return { message: `error: ${clip(event.message, 500)}`, detail: event.message };
  }
  return { message: `${type} event`, detail: safeJson(event) };
}

export function readCodexErrorMessage(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return safeJson(value);
}

export function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeJson(value) ?? String(value);
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
