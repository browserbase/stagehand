import * as childProcess from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type EveEvent = {
  readonly type: string;
  readonly data?: unknown;
  readonly meta?: { readonly at?: string; readonly id?: string };
};

export type EveTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export type EveSessionStatus = "completed" | "max_turns" | "sdk_error";

export type EveSessionResult = {
  events: EveEvent[];
  finalMessage: string;
  status: EveSessionStatus;
  stopReason?: string;
  tokenUsage: EveTokenUsage;
  sessionId?: string;
  serverUrl?: string;
  iterationError?: unknown;
};

export type EveMessageResponseLike = AsyncIterable<EveEvent> & { readonly sessionId: string };
export type EveClientSessionLike = {
  send(input: { message: string; signal?: AbortSignal }): Promise<EveMessageResponseLike>;
  cancel(options?: { turnId?: string }): Promise<unknown>;
};
export type EveClientLike = {
  health(): Promise<unknown>;
  session(): EveClientSessionLike;
};

export const EVE_PACKAGE = "eve";

export function resolveEveBinPath(): string {
  try {
    const packagePath = createRequire(import.meta.url).resolve(`${EVE_PACKAGE}/package.json`);
    return path.join(path.dirname(packagePath), "bin", "eve.js");
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Eve harness requires ${EVE_PACKAGE}. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
}

export function resolveEveAppNodeModulesDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules");
}

export async function loadEveClient(host: string): Promise<EveClientLike> {
  try {
    const specifier = `${EVE_PACKAGE}/client`;
    const mod = (await import(specifier)) as {
      Client?: new (options: { host: string }) => EveClientLike;
    };
    if (typeof mod.Client !== "function") throw new Error("Client export missing");
    return new mod.Client({ host });
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Eve harness requires ${EVE_PACKAGE}/client. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
}

export function parseEveDevServerUrl(line: string): string | undefined {
  const match = line.match(/\[DEV\] server listening at (https?:\/\/\S+)/);
  return match?.[1]?.replace(/\/+$/, "");
}

export type EveDevServerHandle = {
  url: string;
  pid?: number;
  close(): Promise<void>;
};

export async function startEveDevServer(input: {
  appRoot: string;
  env: Record<string, string>;
  logger: HarnessLogger;
  signal?: AbortSignal;
  port?: number;
  readyTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  eveBinPath?: string;
  spawn?: typeof childProcess.spawn;
}): Promise<EveDevServerHandle> {
  const spawn = input.spawn ?? childProcess.spawn;
  const readyTimeoutMs = positiveInteger(input.readyTimeoutMs, 120_000);
  const shutdownTimeoutMs = positiveInteger(input.shutdownTimeoutMs, 10_000);
  const outputLines: string[] = [];
  const child = spawn(
    process.execPath,
    [input.eveBinPath ?? resolveEveBinPath(), "dev", "--no-ui", "--port", String(input.port ?? 0)],
    { cwd: input.appRoot, env: input.env, stdio: ["ignore", "pipe", "pipe"] },
  ) as ChildProcess;

  let closePromise: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    closePromise ??= closeChild(child, shutdownTimeoutMs);
    await closePromise;
  };
  const abort = (): void => void close();
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener("abort", abort, { once: true });

  try {
    const url = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const fail = (message: string, cause?: unknown): void => {
        const tail = outputLines.slice(-20).join("\n");
        finish(() =>
          reject(
            new HarnessAdapterError(`${message}${tail ? `\n${tail}` : ""}`, {
              ...(cause !== undefined && { cause }),
            }),
          ),
        );
      };
      const onLine = (line: string): void => {
        const sanitized = sanitizeErrorMessage(line);
        if (outputLines.length >= 20) outputLines.shift();
        outputLines.push(sanitized);
        input.logger.log({ category: "eve", message: sanitized, level: 2 });
        const serverUrl = parseEveDevServerUrl(line);
        if (serverUrl) finish(() => resolve(serverUrl));
      };
      lineBuffer(child.stdout, onLine);
      lineBuffer(child.stderr, onLine);
      child.once("error", (error) => fail("Eve dev server failed before it was ready.", error));
      child.once("exit", (code, signal) =>
        fail(
          `Eve dev server exited before it was ready (code ${String(code)}, signal ${String(signal)}).`,
        ),
      );
      const timer = setTimeout(
        () => fail(`Eve dev server did not become ready within ${readyTimeoutMs}ms.`),
        readyTimeoutMs,
      );
    });
    return { url, ...(child.pid !== undefined && { pid: child.pid }), close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

export async function runEveSession(input: {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  signal?: AbortSignal;
  server:
    | {
        appRoot: string;
        env: Record<string, string>;
        port?: number;
        readyTimeoutMs?: number;
        eveBinPath?: string;
        spawn?: typeof childProcess.spawn;
      }
    | { url: string };
  client?: EveClientLike;
  maxToolSteps?: number;
  onToolStep?: (toolName: string) => void | Promise<void>;
  onToolResult?: (toolName: string) => void | Promise<void>;
}): Promise<EveSessionResult> {
  const events: EveEvent[] = [];
  let finalMessage = "";
  let stopReason: string | undefined;
  let iterationError: unknown;
  let sessionId: string | undefined;
  let serverUrl: string | undefined;
  let turnCompleted = false;
  let maxTurns = false;
  let serverHandle: EveDevServerHandle | undefined;
  let session: EveClientSessionLike | undefined;
  let cancelled = false;
  const maxToolSteps = positiveInteger(input.maxToolSteps, 50);
  const controller = new AbortController();
  const cancelSession = (): Promise<unknown> | undefined => {
    if (!session || cancelled) return undefined;
    cancelled = true;
    return session.cancel().catch((): undefined => undefined);
  };
  const forwardAbort = (): void => {
    stopReason = sanitizeErrorMessage(stringifyError(input.signal?.reason) || "aborted");
    controller.abort(input.signal?.reason);
    void cancelSession();
  };
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });

  input.logger.log({
    category: "eve",
    message: `Starting Eve session with model ${input.model}.`,
    level: 1,
  });

  try {
    if ("appRoot" in input.server) {
      serverHandle = await startEveDevServer({
        ...input.server,
        logger: input.logger,
        signal: input.signal,
      });
      serverUrl = serverHandle.url;
    } else {
      serverUrl = input.server.url.replace(/\/+$/, "");
    }
    const client = input.client ?? (await loadEveClient(serverUrl));
    await client.health();
    session = client.session();
    if (input.signal?.aborted) void cancelSession();
    const response = await session.send({ message: input.prompt, signal: controller.signal });
    sessionId = response.sessionId;
    let toolStepCount = 0;

    for await (const event of response) {
      events.push(event);
      logEveEvent(input.logger, event);
      const data = isRecord(event.data) ? event.data : undefined;

      if (event.type === "message.completed" && typeof data?.message === "string") {
        finalMessage = data.message;
      } else if (event.type === "step.completed") {
        // Usage is aggregated from the complete event list below.
      } else if (event.type === "actions.requested" && Array.isArray(data?.actions)) {
        for (const action of data.actions) {
          if (!isRecord(action) || action.kind !== "tool-call") continue;
          const toolName = typeof action.toolName === "string" ? action.toolName : "tool";
          await input.onToolStep?.(toolName);
        }
      } else if (event.type === "action.result") {
        const result = isRecord(data?.result) ? data.result : undefined;
        if (result?.kind === "tool-result" && typeof result.toolName === "string") {
          await input.onToolResult?.(result.toolName);
          if (data?.status === "completed" && result.isError !== true) {
            toolStepCount += 1;
            if (toolStepCount >= maxToolSteps && !maxTurns) {
              maxTurns = true;
              stopReason = `tool step budget exhausted (${maxToolSteps} steps)`;
              await cancelSession();
              controller.abort(new Error(stopReason));
              break;
            }
          }
        }
      } else if (event.type === "input.requested") {
        const requests = Array.isArray(data?.requests) ? data.requests : [];
        const kinds = requests
          .map((request) => (isRecord(request) ? String(request.kind ?? "unknown") : "unknown"))
          .join(", ");
        stopReason = `eve parked for human input (${kinds})`;
        await cancelSession();
        controller.abort(new Error(stopReason));
      } else if (
        event.type === "step.failed" ||
        event.type === "turn.failed" ||
        event.type === "session.failed"
      ) {
        stopReason = readEveFailureMessage(data) ?? event.type;
      } else if (event.type === "turn.completed") {
        turnCompleted = true;
      }
    }

    if (!turnCompleted && !stopReason && !maxTurns) {
      stopReason = "eve stream ended without a turn boundary";
    }
  } catch (error) {
    iterationError = new HarnessAdapterError("Eve session failed.");
    input.logger.warn({
      category: "eve",
      message: `Eve stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: {
        error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" },
      },
    });
    await cancelSession();
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    await serverHandle?.close();
  }

  return {
    events,
    finalMessage,
    status: resolveEveStatus(iterationError, stopReason, turnCompleted, maxTurns),
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    tokenUsage: extractEveTokenUsage(events),
    ...(sessionId && { sessionId }),
    ...(serverUrl && { serverUrl }),
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function resolveEveStatus(
  iterationError: unknown,
  stopReason: string | undefined,
  turnCompleted: boolean,
  maxTurns = false,
): EveSessionStatus {
  if (maxTurns) return "max_turns";
  return !iterationError && !stopReason && turnCompleted ? "completed" : "sdk_error";
}

export function extractEveTokenUsage(events: EveEvent[]): EveTokenUsage {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let costUsd = 0;
  let hasCostUsd = false;
  for (const event of events) {
    if (event.type !== "step.completed") continue;
    const data = isRecord(event.data) ? event.data : undefined;
    const stepUsage = isRecord(data?.usage) ? data.usage : undefined;
    usage.inputTokens += toFiniteNumber(stepUsage?.inputTokens);
    usage.outputTokens += toFiniteNumber(stepUsage?.outputTokens);
    usage.cacheReadTokens += toFiniteNumber(stepUsage?.cacheReadTokens);
    usage.cacheWriteTokens += toFiniteNumber(stepUsage?.cacheWriteTokens);
    if (isFiniteNumeric(stepUsage?.costUsd)) {
      costUsd += Number(stepUsage.costUsd);
      hasCostUsd = true;
    }
  }
  return {
    ...usage,
    totalTokens: Object.values(usage).reduce((sum, value) => sum + value, 0),
    ...(hasCostUsd && { costUsd }),
  };
}

function isFiniteNumeric(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)))
  );
}

export function buildEveTranscript(events: EveEvent[]): string {
  return events
    .map((event) => summarizeEveEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logEveEvent(logger: HarnessLogger, event: EveEvent): void {
  const summary = summarizeEveEvent(event);
  const message = sanitizeErrorMessage(summary.message);
  const detail = summary.detail ? sanitizeErrorMessage(summary.detail) : undefined;
  logger.log({
    category: "eve",
    message,
    level: 1,
    auxiliary: {
      type: { value: event.type, type: "string" },
      ...(detail && { detail: { value: detail, type: "string" } }),
    },
  });
}

export function summarizeEveEvent(event: EveEvent): { message: string; detail?: string } {
  const data = isRecord(event.data) ? event.data : undefined;
  if (event.type === "message.completed" && typeof data?.message === "string") {
    return { message: `agent: ${clip(data.message, 500)}`, detail: data.message };
  }
  if (event.type === "action.result") {
    const result = isRecord(data?.result) ? data.result : undefined;
    return {
      message: `tool: ${String(result?.toolName ?? "")} ${String(data?.status ?? "")}`.trim(),
      detail: safeJson(data),
    };
  }
  if (event.type === "step.completed") {
    return { message: "step completed", detail: safeJson(data?.usage) };
  }
  if (event.type.endsWith(".failed")) {
    const message = readEveFailureMessage(data) ?? event.type;
    return { message: `${event.type.replace(".", " ")}: ${clip(message, 500)}`, detail: message };
  }
  return { message: `${event.type} event`, detail: safeJson(event) };
}

function readEveFailureMessage(data: Record<string, unknown> | undefined): string | undefined {
  return typeof data?.message === "string" ? data.message : undefined;
}

function lineBuffer(stream: ChildProcess["stdout"], onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (pending) onLine(pending);
  });
}

async function closeChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      shutdownTimer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(shutdownTimer));
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
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
