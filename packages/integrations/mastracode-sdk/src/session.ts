import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addTokenUsage, isRecord, stringifyError, type ProviderResponseUsage } from "./config.js";
import {
  MASTRACODE_PROTOCOL_VERSION,
  type MastracodeDriverEvent,
  type MastracodeDriverRequest,
  type MastracodeEventOf,
  type MastracodeTokenUsage,
} from "./protocol.js";

export const MASTRACODE_DRIVER_PATH_ENV = "EVAL_MASTRACODE_DRIVER_PATH";

export interface MastracodeProcessInput {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal: AbortSignal;
  onStdoutLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface MastracodeProcessOutput {
  exitCode: number | null;
  signal?: string | null;
  stderr: string;
}

export type MastracodeProcessRunner = (
  input: MastracodeProcessInput,
) => Promise<MastracodeProcessOutput>;

export interface MastracodeProcessRunnerOptions {
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  processHooks?: Pick<NodeJS.Process, "on">;
  killGraceMs?: number;
}

const liveChildren = new Set<ChildProcess>();

/**
 * Spawn the driver in its own process group and stream its stdout by line.
 * Abort sends SIGTERM to the group (the driver and the MCP children it
 * started), then SIGKILL after a grace period; parent exit kills the group.
 * Same lifecycle as fx-sdk's createFxProcessRunner. None of these hooks runs
 * if the parent dies by SIGKILL or a V8 heap OOM, so the driver also watches
 * for its parent's death and aborts itself (lifecycle.ts watchParent).
 */
export function createMastracodeProcessRunner(
  options: MastracodeProcessRunnerOptions = {},
  trackedChildren: Set<ChildProcess> = liveChildren,
): MastracodeProcessRunner {
  const spawnProcess = options.spawnProcess ?? spawn;
  const killProcess = options.killProcess ?? process.kill.bind(process);
  const processHooks = options.processHooks ?? process;
  const killGraceMs = options.killGraceMs ?? 2_000;
  const terminationTimers = new Map<ChildProcess, NodeJS.Timeout>();
  let hooksRegistered = false;

  const signalChild = (child: ChildProcess, signal: NodeJS.Signals): void => {
    if (process.platform !== "win32" && typeof child.pid === "number") {
      try {
        killProcess(-child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child if the process group is already gone.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // The child may have exited between the abort check and the signal.
    }
  };

  const terminateChild = (child: ChildProcess, immediateKill = false): void => {
    const existing = terminationTimers.get(child);
    if (existing) {
      if (!immediateKill) return;
      clearTimeout(existing);
      terminationTimers.delete(child);
    }
    signalChild(child, "SIGTERM");
    if (immediateKill) {
      signalChild(child, "SIGKILL");
      return;
    }
    const timer = setTimeout(() => {
      terminationTimers.delete(child);
      signalChild(child, "SIGKILL");
    }, killGraceMs);
    terminationTimers.set(child, timer);
    timer.unref();
  };

  const reapGroup = (child: ChildProcess): void => {
    if (process.platform === "win32" || typeof child.pid !== "number") return;
    try {
      killProcess(-child.pid, "SIGKILL");
    } catch {
      // ESRCH: nothing left in the group.
    }
  };

  const untrackChild = (child: ChildProcess): void => {
    trackedChildren.delete(child);
    const timer = terminationTimers.get(child);
    if (timer) clearTimeout(timer);
    terminationTimers.delete(child);
  };

  const registerHooks = (): void => {
    if (hooksRegistered) return;
    hooksRegistered = true;
    const terminateAll = (immediateKill: boolean): void => {
      for (const child of trackedChildren) terminateChild(child, immediateKill);
    };
    // The exit event only permits synchronous work, so send both signals there.
    processHooks.on("exit", () => terminateAll(true));
    processHooks.on("SIGINT", () => terminateAll(false));
    processHooks.on("SIGTERM", () => terminateAll(false));
  };

  return (input) =>
    new Promise((resolve) => {
      let stderr = "";
      let stdoutRemainder = "";
      let stderrRemainder = "";
      let settled = false;
      let child: ChildProcess | undefined;

      const finish = (exitCode: number | null, signal?: string | null): void => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener("abort", abort);
        if (stdoutRemainder.trim()) input.onStdoutLine(stdoutRemainder);
        if (stderrRemainder) input.onStderrLine?.(stderrRemainder);
        resolve({ exitCode, signal, stderr });
      };
      const abort = (): void => {
        if (child && !settled) terminateChild(child);
      };

      try {
        registerHooks();
        child = spawnProcess(input.bin, input.args, {
          cwd: input.cwd,
          env: input.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        const spawned = child;
        trackedChildren.add(spawned);
        spawned.stdout?.setEncoding("utf8");
        spawned.stderr?.setEncoding("utf8");
        spawned.stdout?.on("data", (chunk: Buffer | string) => {
          const lines = `${stdoutRemainder}${String(chunk)}`.split(/\r?\n/u);
          stdoutRemainder = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) input.onStdoutLine(line);
        });
        spawned.stderr?.on("data", (chunk: Buffer | string) => {
          const text = String(chunk);
          stderr = `${stderr}${text}`.slice(-64_000);
          const lines = `${stderrRemainder}${text}`.split(/\r?\n/u);
          stderrRemainder = lines.pop() ?? "";
          for (const line of lines) input.onStderrLine?.(line);
        });
        spawned.once("error", (error) => {
          untrackChild(spawned);
          stderr += `${stderr ? "\n" : ""}${stringifyError(error)}`;
          finish(null);
        });
        spawned.once("close", (exitCode, signal) => {
          untrackChild(spawned);
          // The driver is gone, but MCP children it started (the facade bridge)
          // may outlive it, e.g. after a startup timeout: reap its process group.
          reapGroup(spawned);
          finish(exitCode, signal);
        });
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
        spawned.stdin?.on("error", () => undefined);
        spawned.stdin?.end(input.stdin);
      } catch (error) {
        stderr += stringifyError(error);
        finish(null);
      }
    });
}

const defaultProcessRunner = createMastracodeProcessRunner();

/** The built driver next to this module (dist/driver.mjs), unless overridden. */
export function resolveMastracodeDriverPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[MASTRACODE_DRIVER_PATH_ENV]?.trim();
  if (override) return path.resolve(override);
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "driver.mjs");
}

/** Parse one stdout line; anything that is not a protocol event is ignored. */
export function parseDriverEventLine(line: string): MastracodeDriverEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      isRecord(parsed) &&
      parsed.v === MASTRACODE_PROTOCOL_VERSION &&
      typeof parsed.type === "string"
    ) {
      return parsed as unknown as MastracodeDriverEvent;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type MastracodeSessionStatus = "completed" | "max_turns" | "sdk_error";

export interface MastracodeSessionResult {
  status: MastracodeSessionStatus;
  stopReason?: string;
  iterationError?: string;
  /** The agent's last message (text of the last model step that produced text). */
  finalText: string;
  events: MastracodeDriverEvent[];
  ready?: MastracodeEventOf<"ready">;
  done?: MastracodeEventOf<"done">;
  requests: MastracodeEventOf<"request">[];
  violations: MastracodeEventOf<"violation">[];
  /** Model steps observed (one per `usage_update`). */
  steps: number;
  /** Sum of every step's usage; buckets no step reported stay absent. */
  usage?: MastracodeTokenUsage;
  /**
   * Usage parsed from the raw provider responses, split into the agent loop
   * (cross-check for `usage`) and tool-less side calls mastracode makes on its
   * own (titles, observational memory), which no `usage_update` reports.
   */
  responseUsage: {
    agent?: ResponseUsageSum;
    side?: ResponseUsageSum;
  };
  toolCalls: number;
  exitCode: number | null;
  signal?: string | null;
  stderrTail: string;
}

export interface ResponseUsageSum extends ProviderResponseUsage {
  requests: number;
  models: string[];
}

function addResponseUsage(
  sum: ResponseUsageSum | undefined,
  usage: ProviderResponseUsage,
  model: string,
): ResponseUsageSum {
  return {
    requests: (sum?.requests ?? 0) + 1,
    models: [...new Set([...(sum?.models ?? []), model])],
    inputTokens: (sum?.inputTokens ?? 0) + usage.inputTokens,
    cachedInputTokens: (sum?.cachedInputTokens ?? 0) + usage.cachedInputTokens,
    cacheCreationInputTokens: (sum?.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens,
    outputTokens: (sum?.outputTokens ?? 0) + usage.outputTokens,
  };
}

export interface RunMastracodeSessionInput {
  request: MastracodeDriverRequest;
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  runProcess?: MastracodeProcessRunner;
  driverPath?: string;
  /** Hard kill of the driver process group; the driver's own timeout should fire first. */
  killAfterMs?: number;
  onEvent?: (event: MastracodeDriverEvent) => void;
  onStderrLine?: (line: string) => void;
}

/** Run one task in a fresh driver process and fold its event stream into a result. */
export async function runMastracodeSession(
  input: RunMastracodeSessionInput,
): Promise<MastracodeSessionResult> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let killedForTimeout = false;
  const killTimer =
    input.killAfterMs && input.killAfterMs > 0
      ? setTimeout(() => {
          killedForTimeout = true;
          controller.abort();
        }, input.killAfterMs)
      : undefined;
  killTimer?.unref();

  const events: MastracodeDriverEvent[] = [];
  const runProcess = input.runProcess ?? defaultProcessRunner;
  let output: MastracodeProcessOutput;
  try {
    output = await runProcess({
      bin: process.execPath,
      args: [input.driverPath ?? resolveMastracodeDriverPath()],
      cwd: input.cwd,
      env: input.env,
      stdin: JSON.stringify(input.request),
      signal: controller.signal,
      onStdoutLine: (line) => {
        const event = parseDriverEventLine(line);
        if (!event) {
          input.onStderrLine?.(`[stdout] ${line.slice(0, 500)}`);
          return;
        }
        events.push(event);
        try {
          input.onEvent?.(event);
        } catch {
          // Observers must not break event collection.
        }
      },
      onStderrLine: input.onStderrLine,
    });
  } catch (error) {
    output = { exitCode: null, stderr: stringifyError(error) };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  return foldMastracodeEvents(events, {
    exitCode: output.exitCode,
    signal: output.signal,
    stderr: output.stderr,
    aborted: input.signal?.aborted === true,
    killedForTimeout,
  });
}

export interface FoldOptions {
  exitCode: number | null;
  signal?: string | null;
  stderr: string;
  aborted?: boolean;
  killedForTimeout?: boolean;
}

/** Reduce a driver event stream (live or from a fixture) to a session result. */
export function foldMastracodeEvents(
  events: MastracodeDriverEvent[],
  options: FoldOptions,
): MastracodeSessionResult {
  const requests: MastracodeEventOf<"request">[] = [];
  const violations: MastracodeEventOf<"violation">[] = [];
  let ready: MastracodeEventOf<"ready"> | undefined;
  let done: MastracodeEventOf<"done"> | undefined;
  let usage: MastracodeTokenUsage | undefined;
  const responseUsage: MastracodeSessionResult["responseUsage"] = {};
  let steps = 0;
  let toolCalls = 0;
  let lastStepText = "";
  for (const event of events) {
    switch (event.type) {
      case "ready":
        ready = event;
        break;
      case "request":
        requests.push(event);
        break;
      case "request_usage":
        responseUsage[event.role] = addResponseUsage(
          responseUsage[event.role],
          event.usage,
          event.model,
        );
        break;
      case "violation":
        violations.push(event);
        break;
      case "tool_start":
        toolCalls += 1;
        break;
      case "step":
        steps += 1;
        usage = addTokenUsage(usage, event.usage);
        if (event.text.trim()) lastStepText = event.text.trim();
        break;
      case "done":
        done = event;
        break;
      default:
        break;
    }
  }
  const stderrTail = options.stderr.trim().split(/\r?\n/u).slice(-20).join("\n").slice(-4_000);
  const base = {
    finalText: done?.finalText ?? lastStepText,
    events,
    ...(ready && { ready }),
    ...(done && { done }),
    requests,
    violations,
    steps,
    ...(usage && { usage }),
    responseUsage,
    toolCalls,
    exitCode: options.exitCode,
    signal: options.signal,
    stderrTail,
  };
  const sdkError = (stopReason: string, iterationError?: string): MastracodeSessionResult => ({
    ...base,
    status: "sdk_error",
    stopReason,
    ...(iterationError && { iterationError }),
  });

  if (violations.length > 0) {
    const names = [...new Set(violations.flatMap((violation) => violation.names))];
    return sdkError("tool_isolation_violation", `tool isolation violation: ${names.join(", ")}`);
  }
  if (options.killedForTimeout)
    return sdkError("timeout", "mastracode driver killed at the wall-clock limit");
  if (options.aborted) return sdkError("aborted", "mastracode run aborted");
  if (!done) {
    const exit = options.signal ? `signal ${options.signal}` : `code ${options.exitCode}`;
    const lastLine = stderrTail.split("\n").at(-1)?.slice(0, 300);
    return sdkError(
      `driver_exited_without_result (${exit})${lastLine ? `: ${lastLine}` : ""}`,
      `mastracode driver exited (${exit}) without a result${stderrTail ? `: ${stderrTail}` : ""}`,
    );
  }
  if (options.exitCode !== 0) {
    return sdkError(
      done.stopReason ?? "driver_exit_nonzero",
      done.error ?? `mastracode driver exited with code ${options.exitCode}`,
    );
  }
  switch (done.status) {
    case "completed":
      return { ...base, status: "completed" };
    case "max_turns":
      return { ...base, status: "max_turns", stopReason: "max_steps" };
    case "timeout":
      return sdkError("timeout", done.error ?? "mastracode run timed out");
    case "aborted":
      return sdkError("aborted", done.error ?? "mastracode run aborted");
    default:
      return sdkError(done.stopReason ?? "mastracode_error", done.error ?? done.stopReason);
  }
}

/** Assistant text of every step, for the raw transcript. */
export function buildMastracodeTranscript(events: readonly MastracodeDriverEvent[]): string {
  return events
    .flatMap((event) => (event.type === "step" && event.text.trim() ? [event.text.trim()] : []))
    .join("\n\n");
}
