import { spawn } from "node:child_process";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type CursorEvent = Record<string, unknown>;

export type CursorProcessExit = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type CursorProcessRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal: AbortSignal;
  onStdoutLine: (line: string) => void | Promise<void>;
  onStderr: (chunk: string) => void;
}) => Promise<CursorProcessExit>;

export type CursorSessionConfig = {
  cwd?: string;
  env?: Record<string, string>;
  binaryPath?: string;
  apiKey?: string;
  force?: boolean;
  trust?: boolean;
  approveMcps?: boolean;
  sandbox?: "enabled" | "disabled";
  extraArgs?: string[];
};

export type CursorTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reported: false;
};

export type CursorSessionResult = {
  events: CursorEvent[];
  resultEvent?: CursorEvent;
  resultText: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: CursorTokenUsage;
  exit?: CursorProcessExit;
  stderr: string;
  iterationError?: unknown;
};

export type CursorToolCallView = {
  callId: string;
  subtype: "started" | "completed" | string;
  kind: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  ok: boolean;
  error?: string;
};

export const CURSOR_AGENT_BINARY = "agent";
const STDERR_LIMIT = 64 * 1024;

export function resolveCursorAgentBinary(override?: string): string {
  return override ?? process.env.CURSOR_AGENT_PATH ?? CURSOR_AGENT_BINARY;
}

export function normalizeCursorModel(model: string): string | undefined {
  if (model === "cursor/auto" || model === "auto") return undefined;
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function buildCursorAgentArgs(input: {
  prompt: string;
  model?: string;
  session: CursorSessionConfig;
}): string[] {
  const { session } = input;
  return [
    "-p",
    "--output-format",
    "stream-json",
    ...(session.force !== false ? ["--force"] : []),
    ...(session.trust !== false ? ["--trust"] : []),
    ...(session.approveMcps !== false ? ["--approve-mcps"] : []),
    ...(session.sandbox ? ["--sandbox", session.sandbox] : []),
    ...(session.cwd ? ["--workspace", session.cwd] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(session.apiKey ? ["--api-key", session.apiKey] : []),
    ...(session.extraArgs ?? []),
    input.prompt,
  ];
}

export function parseCursorStreamLine(line: string): CursorEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractCursorToolCall(event: CursorEvent): CursorToolCallView | undefined {
  if (event.type !== "tool_call" || !isRecord(event.tool_call)) return undefined;
  const entry = Object.entries(event.tool_call)[0];
  if (!entry || !isRecord(entry[1])) return undefined;
  const [rawKind, call] = entry;
  const kind = rawKind === "function" ? "function" : rawKind.replace(/ToolCall$/, "");
  const rawArgs = isRecord(call.args) ? call.args : {};
  let name = kind;
  let args = rawArgs;

  if (kind === "function") {
    name = typeof call.name === "string" ? call.name : "function";
    const value = call.arguments;
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        args = isRecord(parsed) ? parsed : {};
      } catch {
        args = {};
      }
    } else {
      args = isRecord(value) ? value : {};
    }
  } else if (kind === "mcp") {
    // Cursor has not documented its MCP stream-json payload. Accept the
    // observed candidate fields without requiring any one unverified shape.
    const server = readString(rawArgs, ["providerIdentifier", "server", "provider"]) ?? "mcp";
    const tool = readString(rawArgs, ["name", "toolName", "tool"]) ?? "tool";
    name = `${server}.${tool}`;
    args = isRecord(rawArgs.args)
      ? rawArgs.args
      : isRecord(rawArgs.arguments)
        ? rawArgs.arguments
        : rawArgs;
  }

  const resultEnvelope = isRecord(call.result) ? call.result : undefined;
  let result: unknown;
  let ok = true;
  let error: string | undefined;
  if (resultEnvelope && "success" in resultEnvelope) {
    result = resultEnvelope.success;
  } else if (resultEnvelope) {
    for (const key of ["error", "rejected", "failure"] as const) {
      if (key in resultEnvelope) {
        ok = false;
        error = stringifyError(resultEnvelope[key]);
        break;
      }
    }
  }

  return {
    callId: typeof event.call_id === "string" ? event.call_id : "",
    subtype: typeof event.subtype === "string" ? event.subtype : "",
    kind,
    name,
    args,
    ...(result !== undefined && { result }),
    ok,
    ...(error && { error }),
  };
}

export const defaultCursorProcessRunner: CursorProcessRunner = async (input) => {
  return new Promise<CursorProcessExit>((resolve, reject) => {
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
      const lines = stdoutBuffer.split(/\r?\n/);
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
            sanitizeErrorMessage(
              "Cursor agent CLI harness requires the `agent` binary (install: curl https://cursor.com/install -fsS | bash, or set CURSOR_AGENT_PATH)",
            ),
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

export async function runCursorAgentSession(input: {
  prompt: string;
  model: string;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: CursorSessionConfig;
  runProcess?: CursorProcessRunner;
  maxToolSteps?: number;
  onToolResult?: (toolName: string, view: CursorToolCallView) => void | Promise<void>;
}): Promise<CursorSessionResult> {
  const events: CursorEvent[] = [];
  const budgetController = new AbortController();
  const forwardAbort = (): void => budgetController.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) budgetController.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  let resultEvent: CursorEvent | undefined;
  let resultText = "";
  let lastAssistantText = "";
  let stderr = "";
  let exit: CursorProcessExit | undefined;
  let iterationError: unknown;
  let budgetStopReason: string | undefined;
  const maxToolSteps = positiveInteger(input.maxToolSteps, 50);
  let toolStepCount = 0;

  try {
    const model = normalizeCursorModel(input.model);
    exit = await (input.runProcess ?? defaultCursorProcessRunner)({
      command: resolveCursorAgentBinary(input.session.binaryPath),
      args: buildCursorAgentArgs({ prompt: input.prompt, model, session: input.session }),
      ...(input.session.cwd && { cwd: input.session.cwd }),
      env: stringEnv({ ...process.env, ...input.session.env }),
      signal: budgetController.signal,
      onStdoutLine: async (line) => {
        const parsedEvent = parseCursorStreamLine(line);
        if (!parsedEvent) return;
        const event = deepSanitizeCursorEvent(parsedEvent);
        events.push(event);
        logCursorEvent(input.logger, event);
        if (event.type === "assistant") {
          lastAssistantText = extractAssistantTextBlocks(event).at(-1) ?? lastAssistantText;
        }
        if (event.type === "result") {
          resultEvent = event;
          resultText = typeof event.result === "string" ? event.result : "";
        }
        const view = extractCursorToolCall(event);
        if (view?.subtype === "completed") {
          toolStepCount += 1;
          await input.onToolResult?.(view.name, view);
          if (toolStepCount >= maxToolSteps && !budgetController.signal.aborted) {
            budgetStopReason = `tool step budget exhausted (${maxToolSteps} steps)`;
            budgetController.abort(new HarnessAdapterError(budgetStopReason));
          }
        }
      },
      onStderr: (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
      },
    });
  } catch (error) {
    iterationError = new HarnessAdapterError(
      sanitizeErrorMessage(stringifyError(error)) || "Cursor agent session failed.",
    );
    input.logger.warn({
      category: "cursor",
      message: `Cursor stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: {
        error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" },
      },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  stderr = sanitizeErrorMessage(stderr);
  if (stderr) input.logger.log({ category: "cursor", message: stderr, level: 1 });

  if (!resultText) resultText = lastAssistantText;
  const externalAbortReason = input.signal?.aborted
    ? stringifyError(input.signal.reason) || "Cursor agent session aborted"
    : undefined;
  const stopReason = buildCursorStopReason(
    resultEvent,
    iterationError,
    exit,
    stderr,
    budgetStopReason,
    externalAbortReason,
  );
  return {
    events,
    ...(resultEvent && { resultEvent }),
    resultText,
    status: resolveCursorStatus(resultEvent, iterationError, stopReason, Boolean(budgetStopReason)),
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    // Cursor's CLI does not report token usage in any output format.
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
    ...(exit && { exit }),
    stderr,
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function resolveCursorStatus(
  resultEvent: CursorEvent | undefined,
  iterationError: unknown,
  stopReason?: string,
  budgetExhausted = false,
): "completed" | "max_turns" | "sdk_error" {
  if (budgetExhausted) return "max_turns";
  if (iterationError || stopReason || resultEvent?.is_error === true) return "sdk_error";
  return "completed";
}

export function buildCursorStopReason(
  resultEvent: CursorEvent | undefined,
  iterationError: unknown,
  exit: CursorProcessExit | undefined,
  stderr: string,
  budgetStopReason?: string,
  externalAbortReason?: string,
): string | undefined {
  if (budgetStopReason) return sanitizeErrorMessage(budgetStopReason);
  if (externalAbortReason) return sanitizeErrorMessage(externalAbortReason);
  if (iterationError) return sanitizeErrorMessage(stringifyError(iterationError));
  if (resultEvent?.is_error === true) {
    return sanitizeErrorMessage(
      typeof resultEvent.result === "string" && resultEvent.result.trim()
        ? resultEvent.result.trim()
        : "Cursor agent returned an error result",
    );
  }
  if (!resultEvent) {
    const lastLine = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    return sanitizeErrorMessage(
      exit?.exitCode !== 0
        ? `cursor agent exited with code ${String(exit?.exitCode ?? "unknown")}${lastLine ? `: ${lastLine}` : ""}`
        : "Cursor agent exited without a terminal result event",
    );
  }
  return undefined;
}

export function buildCursorTranscript(events: CursorEvent[]): string {
  return events
    .map((event) => summarizeCursorEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logCursorEvent(logger: HarnessLogger, event: CursorEvent): void {
  const summary = summarizeCursorEvent(event);
  logger.log({
    category: "cursor",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeCursorEvent(event: CursorEvent): { message: string; detail?: string } {
  const type = String(event.type ?? "unknown");
  if (type === "assistant") {
    const text = extractAssistantText(event);
    const sanitized = text ? sanitizeErrorMessage(text) : undefined;
    return {
      message: sanitized ? `assistant: ${clip(sanitized, 500)}` : "assistant message",
      detail: sanitized,
    };
  }
  if (type === "tool_call") {
    const view = extractCursorToolCall(event);
    return {
      message: view
        ? `tool: ${view.name} ${view.subtype}${view.ok ? "" : " failed"}`
        : "tool_call event",
      detail: sanitizeOptional(safeJson(event)),
    };
  }
  if (type === "result") {
    return {
      message: `result: ${String(event.subtype ?? "done")}`,
      detail: sanitizeOptional(typeof event.result === "string" ? event.result : safeJson(event)),
    };
  }
  return { message: `${type} event`, detail: sanitizeOptional(safeJson(event)) };
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeErrorMessage(value);
}

function deepSanitizeCursorEvent(event: CursorEvent): CursorEvent {
  return deepSanitizeCursorValue(event) as CursorEvent;
}

function deepSanitizeCursorValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(deepSanitizeCursorValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepSanitizeCursorValue(child)]),
  );
}

function extractAssistantText(event: CursorEvent): string | undefined {
  const parts = extractAssistantTextBlocks(event);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractAssistantTextBlocks(event: CursorEvent): string[] {
  const message = isRecord(event.message) ? event.message : undefined;
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key];
  }
  return undefined;
}

function stringEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
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
