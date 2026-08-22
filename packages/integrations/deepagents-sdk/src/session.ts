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
  iterationError?: unknown;
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
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
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
    kill: (signalName) => void child.kill(signalName),
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
  let iterationError: unknown;
  let exitCode: number | null = null;
  let handle: DeepagentsProcessHandle | undefined;
  const forwardAbort = (): void => handle?.kill("SIGTERM");

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

    const stderrTask = readStderr(handle.stderr, input.logger);
    const stdoutTask = (async () => {
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
            message: `non-JSON stdout: ${clip(line, 500)}`,
            level: 1,
          });
          continue;
        }
        events.push(event);
        logDeepagentsEvent(input.logger, event);
        if (event.type === "final" && typeof event.text === "string") finalMessage = event.text;
        if (event.type === "usage") tokenUsage = extractDeepagentsTokenUsage(event);
        if (event.type === "error") {
          errorKind = typeof event.kind === "string" ? event.kind : "exception";
          stopReason = typeof event.message === "string" ? event.message : "deepagents error";
        }
        if (event.type === "tool_result" && typeof event.name === "string") {
          await input.onToolResult?.(
            event.name,
            typeof event.server === "string" ? event.server : undefined,
          );
        }
      }
    })();
    const [exited] = await Promise.all([handle.exited, stdoutTask, stderrTask]);
    exitCode = exited.code;
    if (exitCode !== 0 && !stopReason) {
      stopReason = `deepagents runner exited with code ${exitCode ?? "null"}`;
    }
  } catch (error) {
    iterationError = error;
    stopReason = sanitizeErrorMessage(stringifyError(error));
    try {
      handle?.kill("SIGTERM");
    } catch {
      // best-effort only
    }
    input.logger.warn({
      category: "deepagents",
      message: `Deep Agents stopped before a normal result: ${stopReason}`,
      level: 0,
      auxiliary: { error: { value: stopReason, type: "string" } },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  const sanitizedReason = stopReason ? sanitizeErrorMessage(stopReason) : undefined;
  return {
    events,
    finalMessage,
    status: resolveDeepagentsStatus(errorKind, exitCode, iterationError),
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
    logger.log({ category: "deepagents", message: line, level: 1 });
  }
}

export function resolveDeepagentsStatus(
  errorKind: string | undefined,
  exitCode: number | null,
  iterationError?: unknown,
): "completed" | "max_turns" | "sdk_error" {
  if (errorKind === "recursion_limit") return "max_turns";
  if (errorKind || iterationError || (exitCode !== null && exitCode !== 0)) return "sdk_error";
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
    .join("\n");
}

export function logDeepagentsEvent(logger: HarnessLogger, event: DeepagentsEvent): void {
  const summary = summarizeDeepagentsEvent(event);
  logger.log({
    category: "deepagents",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeDeepagentsEvent(event: DeepagentsEvent): {
  message: string;
  detail?: string;
} {
  const type = String(event.type ?? "unknown");
  if (type === "assistant" && typeof event.text === "string") {
    return { message: `assistant: ${clip(event.text, 500)}`, detail: event.text };
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
    return { message: `error: ${clip(message, 500)}`, detail: message };
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
