import { spawn } from "node:child_process";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type GrokBuildEvent = Record<string, unknown>;

export type GrokBuildProcessExit = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type GrokBuildProcessRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal: AbortSignal;
  onStdoutLine: (line: string) => void | Promise<void>;
  onStderr: (chunk: string) => void;
}) => Promise<GrokBuildProcessExit>;

export type GrokBuildSessionConfig = {
  cwd?: string;
  env?: Record<string, string>;
  binaryPath?: string;
  maxTurns?: number;
  sandbox?: string;
  extraArgs?: string[];
};

export type GrokBuildTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  reported: boolean;
};

export type GrokBuildSessionResult = {
  events: GrokBuildEvent[];
  endEvent?: GrokBuildEvent;
  resultText: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: GrokBuildTokenUsage;
  costUsd?: number;
  exit?: GrokBuildProcessExit;
  stderr: string;
  iterationError?: unknown;
};

export type GrokBuildToolCallView = {
  callId: string;
  subtype: "started" | "completed";
  name?: string;
  args: Record<string, unknown>;
  result?: unknown;
  ok: boolean;
  error?: string;
};

export const GROK_BUILD_BINARY = "grok";
const STDERR_LIMIT = 64 * 1024;

export function resolveGrokBuildBinary(override?: string): string {
  return override ?? process.env.GROK_BUILD_PATH ?? GROK_BUILD_BINARY;
}

export function normalizeGrokBuildModel(model: string): string | undefined {
  if (model === "grok-build/auto" || model === "auto") return undefined;
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function buildGrokBuildArgs(input: {
  prompt: string;
  model?: string;
  session: GrokBuildSessionConfig;
}): string[] {
  const { session } = input;
  return [
    "-p",
    input.prompt,
    "--output-format",
    "streaming-json",
    "--always-approve",
    "--tools",
    "search_tool,use_tool",
    "--disallowed-tools",
    "Agent",
    "--no-plan",
    "--no-subagents",
    "--disable-web-search",
    ...(session.cwd ? ["--cwd", session.cwd] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(session.maxTurns ? ["--max-turns", String(session.maxTurns)] : []),
    ...(session.sandbox ? ["--sandbox", session.sandbox] : []),
    ...(session.extraArgs ?? []),
  ];
}

export function parseGrokBuildStreamLine(line: string): GrokBuildEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractGrokBuildToolCall(event: GrokBuildEvent): GrokBuildToolCallView | undefined {
  if (event.type === "tool_call") {
    return {
      callId: readString(event.toolCallId) ?? "",
      subtype: "started",
      name: readString(event.toolName),
      args: isRecord(event.rawInput) ? event.rawInput : {},
      ok: true,
    };
  }
  if (event.type !== "tool_call_update") return undefined;
  const status = readString(event.status) ?? "completed";
  if (!["completed", "failed", "cancelled", "rejected"].includes(status)) return undefined;
  const ok = status === "completed";
  const result = event.rawOutput ?? event.content;
  return {
    callId: readString(event.toolCallId) ?? "",
    subtype: "completed",
    args: {},
    ...(result !== undefined && { result }),
    ok,
    ...(!ok && { error: stringifyError(result) || `tool call ${status}` }),
  };
}

export const defaultGrokBuildProcessRunner: GrokBuildProcessRunner = async (input) => {
  return new Promise<GrokBuildProcessExit>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      ...(input.cwd && { cwd: input.cwd }),
      ...(input.env && { env: input.env }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let lineQueue = Promise.resolve();
    let killTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const queueLine = (line: string): void => {
      lineQueue = lineQueue.then(() => input.onStdoutLine(line));
    };
    const removeAbort = (): void => input.signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5_000);
      killTimer.unref();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) queueLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => input.onStderr(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      removeAbort();
      if (killTimer) clearTimeout(killTimer);
      if (error.code === "ENOENT") {
        reject(
          new HarnessAdapterError(
            "Grok Build harness requires the `grok` CLI (install `@xai-official/grok` globally, or set GROK_BUILD_PATH).",
            { cause: error },
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      removeAbort();
      if (killTimer) clearTimeout(killTimer);
      if (stdoutBuffer) queueLine(stdoutBuffer);
      lineQueue.then(
        () => resolve({ exitCode, signal }),
        (error) => reject(error),
      );
    });

    if (input.signal.aborted) abort();
    else input.signal.addEventListener("abort", abort, { once: true });
  });
};

export async function runGrokBuildSession(input: {
  prompt: string;
  model: string;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: GrokBuildSessionConfig;
  runProcess?: GrokBuildProcessRunner;
  onToolResult?: (toolName: string, view: GrokBuildToolCallView) => void | Promise<void>;
}): Promise<GrokBuildSessionResult> {
  const events: GrokBuildEvent[] = [];
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) controller.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const textParts: string[] = [];
  const toolNames = new Map<string, string>();
  let endEvent: GrokBuildEvent | undefined;
  let errorEvent: GrokBuildEvent | undefined;
  let stderr = "";
  let exit: GrokBuildProcessExit | undefined;
  let iterationError: unknown;

  try {
    const model = normalizeGrokBuildModel(input.model);
    exit = await (input.runProcess ?? defaultGrokBuildProcessRunner)({
      command: resolveGrokBuildBinary(input.session.binaryPath),
      args: buildGrokBuildArgs({ prompt: input.prompt, model, session: input.session }),
      ...(input.session.cwd && { cwd: input.session.cwd }),
      env: stringEnv({ ...process.env, ...input.session.env }),
      signal: controller.signal,
      onStdoutLine: async (line) => {
        const parsed = parseGrokBuildStreamLine(line);
        if (!parsed) return;
        const event = deepSanitize(parsed) as GrokBuildEvent;
        events.push(event);
        logGrokBuildEvent(input.logger, event);
        if (event.type === "text" && typeof event.data === "string") textParts.push(event.data);
        if (event.type === "end") endEvent = event;
        if (event.type === "error") errorEvent = event;
        const view = extractGrokBuildToolCall(event);
        if (view?.subtype === "started" && view.callId && view.name) {
          toolNames.set(view.callId, view.name);
        }
        if (view?.subtype === "completed") {
          const toolName = toolNames.get(view.callId) ?? view.name ?? "tool";
          await input.onToolResult?.(toolName, view);
        }
      },
      onStderr: (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
      },
    });
  } catch (error) {
    iterationError = new HarnessAdapterError(
      sanitizeErrorMessage(stringifyError(error)) || "Grok Build session failed.",
    );
    input.logger.warn({
      category: "grok_build",
      message: `Grok Build stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  stderr = sanitizeErrorMessage(stderr);
  if (stderr) input.logger.log({ category: "grok_build", message: stderr, level: 1 });
  const externalAbortReason = input.signal?.aborted
    ? stringifyError(input.signal.reason) || "Grok Build session aborted"
    : undefined;
  const stopReason = buildGrokBuildStopReason({
    endEvent,
    errorEvent,
    iterationError,
    exit,
    stderr,
    externalAbortReason,
  });
  const tokenUsage = readGrokBuildUsage(endEvent);
  const costUsd = finiteNumber(endEvent?.total_cost_usd);
  return {
    events,
    ...(endEvent && { endEvent }),
    resultText: textParts.join(""),
    status: resolveGrokBuildStatus(endEvent, errorEvent, iterationError, stopReason),
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    tokenUsage,
    ...(costUsd !== undefined && { costUsd }),
    ...(exit && { exit }),
    stderr,
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function readGrokBuildUsage(event: GrokBuildEvent | undefined): GrokBuildTokenUsage {
  const usage = isRecord(event?.usage) ? event.usage : undefined;
  const inputTokens = finiteNumber(usage?.input_tokens) ?? 0;
  const cachedInputTokens = finiteNumber(usage?.cache_read_input_tokens) ?? 0;
  const cacheCreationInputTokens = finiteNumber(usage?.cache_creation_input_tokens) ?? 0;
  const outputTokens = finiteNumber(usage?.output_tokens) ?? 0;
  const reasoningOutputTokens = finiteNumber(usage?.reasoning_tokens) ?? 0;
  const totalTokens =
    finiteNumber(usage?.total_tokens) ??
    inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningOutputTokens,
    totalTokens,
    reported: usage !== undefined,
  };
}

export function resolveGrokBuildStatus(
  endEvent: GrokBuildEvent | undefined,
  errorEvent: GrokBuildEvent | undefined,
  iterationError: unknown,
  stopReason?: string,
): "completed" | "max_turns" | "sdk_error" {
  const reason = readString(endEvent?.stopReason) ?? "";
  if (/max_turn/iu.test(reason) || stopReason === "max turns reached") return "max_turns";
  if (iterationError || errorEvent || stopReason || !endEvent) return "sdk_error";
  return "completed";
}

export function buildGrokBuildStopReason(input: {
  endEvent?: GrokBuildEvent;
  errorEvent?: GrokBuildEvent;
  iterationError?: unknown;
  exit?: GrokBuildProcessExit;
  stderr: string;
  externalAbortReason?: string;
}): string | undefined {
  if (input.externalAbortReason) return input.externalAbortReason;
  if (input.iterationError) return stringifyError(input.iterationError);
  if (input.errorEvent) {
    return readString(input.errorEvent.message) ?? "Grok Build returned an error event";
  }
  const reason = readString(input.endEvent?.stopReason);
  if (reason && /max_turn/iu.test(reason)) return "max turns reached";
  if (!input.endEvent) {
    const lastLine = input.stderr
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    return input.exit?.exitCode !== 0
      ? `grok exited with code ${String(input.exit?.exitCode ?? "unknown")}${lastLine ? `: ${lastLine}` : ""}`
      : "Grok Build exited without a terminal end event";
  }
  return undefined;
}

export function buildGrokBuildTranscript(events: GrokBuildEvent[]): string {
  return events
    .map((event) => summarizeGrokBuildEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logGrokBuildEvent(logger: HarnessLogger, event: GrokBuildEvent): void {
  const summary = summarizeGrokBuildEvent(event);
  logger.log({
    category: "grok_build",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: readString(event.type) ?? "unknown", type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeGrokBuildEvent(event: GrokBuildEvent): {
  message: string;
  detail?: string;
} {
  const type = readString(event.type) ?? "unknown";
  if ((type === "text" || type === "thought") && typeof event.data === "string") {
    const detail = sanitizeErrorMessage(event.data);
    return { message: `${type}: ${clip(detail, 500)}`, detail };
  }
  const tool = extractGrokBuildToolCall(event);
  if (tool) {
    return {
      message: `tool: ${tool.name ?? tool.callId ?? "unknown"} ${tool.subtype}${tool.ok ? "" : " failed"}`,
      detail: sanitizeOptional(safeJson(event)),
    };
  }
  if (type === "end") {
    return { message: `end: ${readString(event.stopReason) ?? "done"}`, detail: safeJson(event) };
  }
  return { message: `${type} event`, detail: sanitizeOptional(safeJson(event)) };
}

function deepSanitize(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepSanitize(child)]),
  );
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeErrorMessage(value);
}

function stringEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return safeJson(value) ?? "Unknown error";
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
