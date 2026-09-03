import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type DeepagentsEvent = Record<string, unknown>;

export type DeepagentsMcpServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type DeepagentsSessionConfig = {
  runnerDir?: string;
  uvCommand?: string;
  cwd?: string;
  env?: Record<string, string>;
  mcpServers?: Record<string, DeepagentsMcpServerConfig>;
  systemPrompt?: string;
  recursionLimit?: number;
  maxToolSteps?: number;
  killGraceMs?: number;
  streamDrainMs?: number;
};

export type DeepagentsTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type DeepagentsSessionResult = {
  events: DeepagentsEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: DeepagentsTokenUsage;
  exitCode: number | null;
  iterationError?: string;
};

export type DeepagentsProcessHandle = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: (signal?: NodeJS.Signals) => void;
};

export type DeepagentsProcessSpawner = (spec: {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}) => DeepagentsProcessHandle;

export const spawnDeepagentsProcess: DeepagentsProcessSpawner = (spec) => {
  const detached = process.platform !== "win32";
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached,
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => {
        const message =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? `${spec.command} not found: ${error.message}`
            : error.message;
        reject(new Error(message, { cause: error }));
      });
    },
  );
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill: (signalName) => {
      if (detached && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signalName);
          return;
        } catch {
          // Fall back to the direct child if process-group signaling fails.
        }
      }
      void child.kill(signalName);
    },
  };
};

export const DEFAULT_DEEPAGENTS_RUNNER_DIR = fileURLToPath(
  new URL("../../deepagents/runner/", import.meta.url),
);

export function resolveDeepagentsRunnerDir(override?: string): string {
  return override ?? process.env.STAGEHAND_DEEPAGENTS_RUNNER_DIR ?? DEFAULT_DEEPAGENTS_RUNNER_DIR;
}

export function normalizeDeepagentsModel(model: string): string {
  if (model.includes(":")) return model;
  if (model.startsWith("openai/")) return `openai:${model.slice("openai/".length)}`;
  if (model.startsWith("anthropic/")) return `anthropic:${model.slice("anthropic/".length)}`;
  if (model.startsWith("google/")) return `google_genai:${model.slice("google/".length)}`;
  return model;
}

export function buildDeepagentsRunnerArgs(runnerDir: string): string[] {
  return ["run", "--project", runnerDir, "--locked", "python", path.join(runnerDir, "run_eval.py")];
}

export async function runDeepagentsSession(input: {
  prompt: string;
  model: string;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: DeepagentsSessionConfig;
  spawn?: DeepagentsProcessSpawner;
  onToolResult?: (toolName: string, server?: string) => void | Promise<void>;
}): Promise<DeepagentsSessionResult> {
  const events: DeepagentsEvent[] = [];
  let finalMessage = "";
  let stopReason: string | undefined;
  let errorKind: string | undefined;
  let tokenUsage = extractDeepagentsTokenUsage(undefined);
  let iterationError: string | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let sawFinal = false;
  let sawUsage = false;
  let handle: DeepagentsProcessHandle | undefined;
  let processExited = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let stdoutTask: Promise<void> | undefined;
  let stderrTask: Promise<void> | undefined;
  const killGraceMs = positiveInteger(input.session.killGraceMs, 5_000);
  const streamDrainMs = positiveInteger(input.session.streamDrainMs, killGraceMs);
  const sendSignal = (signal: NodeJS.Signals): void => {
    try {
      handle?.kill(signal);
    } catch {
      // best-effort only
    }
  };
  const beginTermination = (): void => {
    if (!handle || processExited) return;
    sendSignal("SIGTERM");
    if (killTimer === undefined) {
      killTimer = setTimeout(() => {
        if (!processExited) sendSignal("SIGKILL");
      }, killGraceMs);
    }
  };
  const forwardAbort = (): void => beginTermination();

  try {
    const runnerDir = resolveDeepagentsRunnerDir(input.session.runnerDir);
    const command = input.session.uvCommand ?? process.env.STAGEHAND_DEEPAGENTS_UV ?? "uv";
    handle = (input.spawn ?? spawnDeepagentsProcess)({
      command,
      args: buildDeepagentsRunnerArgs(runnerDir),
      ...(input.session.cwd && { cwd: input.session.cwd }),
      // The runner is the agent harness process itself (it needs PATH for uv
      // and the model-provider keys), so it inherits the host env like the
      // Codex/Claude SDK harnesses do. Browser-side allowlisting happens on
      // the MCP server env carried inside mcpServers.
      env: input.session.env ?? inheritedEnv(),
    });
    if (input.signal?.aborted) forwardAbort();
    else input.signal?.addEventListener("abort", forwardAbort, { once: true });

    handle.stdin.on("error", () => {
      // Process startup/exit errors are reported through handle.exited.
    });
    handle.stdin.end(
      JSON.stringify({
        prompt: input.prompt,
        system_prompt: input.session.systemPrompt ?? null,
        model: normalizeDeepagentsModel(input.model),
        mcp_servers: input.session.mcpServers ?? {},
        recursion_limit: positiveInteger(input.session.recursionLimit, 100),
        max_tool_steps: positiveInteger(input.session.maxToolSteps, 50),
      }),
    );

    const exitedTask = handle.exited.then(
      (result) => {
        processExited = true;
        return result;
      },
      (error: unknown) => {
        processExited = true;
        throw error;
      },
    );
    stderrTask = readStderr(handle.stderr, input.logger);
    stdoutTask = (async () => {
      const lines = createInterface({ input: handle!.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        let event: DeepagentsEvent;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) throw new Error("not an object");
          event = parsed;
        } catch {
          input.logger.log({
            category: "deepagents",
            message: `non-JSON stdout: ${clip(sanitizeErrorMessage(line), 500)}`,
            level: 1,
          });
          continue;
        }
        if (shouldSanitizeEvent(event)) event = deepSanitizeEvent(event);
        events.push(event);
        logDeepagentsEvent(input.logger, event);
        if (event.type === "final") {
          sawFinal = true;
          if (typeof event.text === "string") finalMessage = event.text;
        }
        if (event.type === "usage") {
          sawUsage = true;
          tokenUsage = extractDeepagentsTokenUsage(event);
        }
        if (event.type === "error") {
          // A terminal stop classification (budget/recursion) must not be
          // overwritten by a later generic exception (e.g. from teardown).
          const isTerminalKind =
            errorKind === "tool_step_budget" || errorKind === "recursion_limit";
          if (!isTerminalKind) {
            errorKind = typeof event.kind === "string" ? event.kind : "exception";
            stopReason = typeof event.message === "string" ? event.message : "deepagents error";
          }
        }
        if (event.type === "tool_result" && typeof event.name === "string") {
          await input.onToolResult?.(
            event.name,
            typeof event.server === "string" ? event.server : undefined,
          );
        }
      }
    })();
    const exited = await Promise.race([
      exitedTask,
      rejectOnFailure(stdoutTask),
      rejectOnFailure(stderrTask),
    ]);
    exitCode = exited.code;
    exitSignal = exited.signal;
    await drainStreams(handle, [stdoutTask, stderrTask], streamDrainMs);
    if (exitCode === null && !stopReason) {
      stopReason = exitSignal
        ? `deepagents runner terminated by ${exitSignal}`
        : "deepagents runner exited without an exit code";
    } else if (exitCode !== 0 && !stopReason) {
      stopReason = `deepagents runner exited with code ${exitCode}`;
    }
    if (exitCode === 0 && (!sawFinal || !sawUsage) && !stopReason) {
      stopReason =
        "deepagents runner exited without a terminal final/usage event (output truncated?)";
    }
  } catch (error) {
    iterationError = sanitizeErrorMessage(stringifyError(error));
    stopReason = iterationError;
    beginTermination();
    if (handle && !processExited) {
      await waitForExit(handle.exited, killGraceMs);
      if (!processExited) sendSignal("SIGKILL");
    }
    if (handle) await drainStreams(handle, [stdoutTask, stderrTask], streamDrainMs);
    input.logger.warn({
      category: "deepagents",
      message: `Deep Agents stopped before a normal result: ${stopReason}`,
      level: 0,
      auxiliary: { error: { value: stopReason, type: "string" } },
    });
  } finally {
    if (killTimer !== undefined) clearTimeout(killTimer);
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  const sanitizedReason = stopReason ? sanitizeErrorMessage(stopReason) : undefined;
  return {
    events,
    finalMessage,
    status: resolveDeepagentsStatus({
      errorKind,
      exitCode,
      signal: exitSignal,
      iterationError,
      sawTerminalEvents: sawFinal && sawUsage,
    }),
    ...(sanitizedReason && { stopReason: sanitizedReason }),
    tokenUsage,
    exitCode,
    ...(iterationError !== undefined && { iterationError }),
  };
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function readStderr(stream: NodeJS.ReadableStream, logger: HarnessLogger): Promise<void> {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    logger.log({ category: "deepagents", message: sanitizeErrorMessage(line), level: 1 });
  }
}

export function resolveDeepagentsStatus(options: {
  errorKind?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  iterationError?: string;
  sawTerminalEvents: boolean;
}): "completed" | "max_turns" | "sdk_error" {
  if (
    options.iterationError ||
    options.exitCode !== 0 ||
    options.signal !== null ||
    !options.sawTerminalEvents
  ) {
    return "sdk_error";
  }
  if (options.errorKind === "recursion_limit" || options.errorKind === "tool_step_budget") {
    return "max_turns";
  }
  if (options.errorKind) return "sdk_error";
  return "completed";
}

export function extractDeepagentsTokenUsage(
  event: Record<string, unknown> | undefined,
): DeepagentsTokenUsage {
  return {
    inputTokens: toFiniteNumber(event?.input_tokens),
    outputTokens: toFiniteNumber(event?.output_tokens),
    cacheReadInputTokens: toFiniteNumber(event?.cache_read_input_tokens),
    reasoningOutputTokens: toFiniteNumber(event?.reasoning_output_tokens),
    totalTokens: toFiniteNumber(event?.total_tokens),
  };
}

export function buildDeepagentsTranscript(events: DeepagentsEvent[]): string {
  return events
    .map((event) => summarizeDeepagentsEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .map((detail) => sanitizeErrorMessage(detail))
    .join("\n");
}

export function logDeepagentsEvent(logger: HarnessLogger, event: DeepagentsEvent): void {
  const summary = summarizeDeepagentsEvent(event);
  logger.log({
    category: "deepagents",
    message: sanitizeErrorMessage(summary.message),
    level: 1,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && {
        detail: { value: sanitizeErrorMessage(summary.detail), type: "string" },
      }),
    },
  });
}

function rejectOnFailure(task: Promise<void>): Promise<never> {
  return task.then(
    () => new Promise<never>(() => undefined),
    (error: unknown) => Promise.reject(error),
  );
}

async function drainStreams(
  handle: DeepagentsProcessHandle,
  tasks: Array<Promise<void> | undefined>,
  timeoutMs: number,
): Promise<void> {
  const active = tasks.filter((task): task is Promise<void> => task !== undefined);
  if (active.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drained = Promise.allSettled(active);
  const timedOut = await Promise.race([
    drained.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (!timedOut) return;
  destroyStream(handle.stdout);
  destroyStream(handle.stderr);
}

function destroyStream(stream: NodeJS.ReadableStream): void {
  (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
}

async function waitForExit(
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    exited.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

export function summarizeDeepagentsEvent(event: DeepagentsEvent): {
  message: string;
  detail?: string;
} {
  const type = String(event.type ?? "unknown");
  if (type === "assistant" && typeof event.text === "string") {
    return {
      message: `assistant: ${clip(sanitizeErrorMessage(event.text), 500)}`,
      detail: event.text,
    };
  }
  if (type === "tool_result") {
    const prefix = typeof event.server === "string" ? `${event.server}.` : "";
    return {
      message: `tool: ${prefix}${String(event.name ?? "")} ${event.ok === false ? "error" : "ok"}`,
      detail: safeJson(event),
    };
  }
  if (type === "final") return { message: "final", detail: String(event.text ?? "") };
  if (type === "usage") return { message: "usage", detail: safeJson(event) };
  if (type === "error") {
    const message = typeof event.message === "string" ? event.message : "error";
    return {
      message: `error: ${clip(sanitizeErrorMessage(message), 500)}`,
      detail: message,
    };
  }
  return { message: `${type} event`, detail: safeJson(event) };
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

function shouldSanitizeEvent(event: DeepagentsEvent): boolean {
  if (event.type === "error" || (event.type === "tool_result" && event.ok === false)) return true;
  return containsSensitiveTextField(event);
}

function containsSensitiveTextField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveTextField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      ((key === "error" || key === "message" || key === "detail") && typeof child === "string") ||
      containsSensitiveTextField(child),
  );
}

function deepSanitizeEvent(event: DeepagentsEvent): DeepagentsEvent {
  return deepSanitizeValue(event) as DeepagentsEvent;
}

function deepSanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(deepSanitizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepSanitizeValue(child)]),
  );
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
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
