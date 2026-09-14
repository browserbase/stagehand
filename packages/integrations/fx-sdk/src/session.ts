import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type FxToolCallRecord = {
  id?: string;
  name?: string;
  arguments_json?: string;
  provider_result?: unknown;
  [key: string]: unknown;
};

export type FxToolResultRecord = {
  tool_call_id?: string;
  tool_name?: string;
  status?: string;
  output?: string;
  truncated?: boolean;
  [key: string]: unknown;
};

export type FxAskOutput = {
  output?: string;
  exit_code?: number;
  model?: string;
  session_id?: string;
  steps?: number;
  tool_calls?: Array<Record<string, unknown>>;
  error?: string;
  terminal_reason?: string;
  [key: string]: unknown;
};

export type FxToolStep = {
  assistant: string;
  tool_calls: FxToolCallRecord[];
  tool_results: FxToolResultRecord[];
};

export type FxLogEvent = {
  kind?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FxEvent =
  | {
      type: "tool_step";
      assistant: string;
      tool_calls: FxToolCallRecord[];
      tool_results: FxToolResultRecord[];
    }
  | { type: "assistant"; text: string }
  | { type: "ask_result"; ask: FxAskOutput }
  | { type: "stderr"; line: string }
  | { type: "turn_committed"; terminal_reason?: string; turn_kind?: string };

export type FxTokenUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_cost?: number;
};

export type FxSessionResult = {
  events: FxEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: FxTokenUsage;
  sessionId?: string;
  exitCode?: number;
  iterationError?: unknown;
  observedToolCallKeys: string[];
};

export type FxProcessRunner = (input: {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal: AbortSignal;
  onStderrLine?: (line: string) => void;
}) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
}>;

export type FxProcessRunnerOptions = {
  spawnProcess?: typeof spawn;
  killProcess?: typeof process.kill;
  processHooks?: Pick<NodeJS.Process, "on">;
  killGraceMs?: number;
};

export type FxSessionStore = {
  waitForSessionDir(home: string, signal: AbortSignal): Promise<string | undefined>;
  readEventsJsonl(sessionDir: string): Promise<string>;
  readEventsJsonlChunk?(
    sessionDir: string,
    offset: number,
  ): Promise<{ text: string; nextOffset: number }>;
  readUsageSnapshot?(sessionDir: string): Promise<Record<string, unknown> | undefined>;
};

export const FX_BIN_ENV = "EVAL_FX_PATH";

export function resolveFxBin(override?: string): string {
  return override ?? process.env[FX_BIN_ENV] ?? "fx";
}

export function normalizeFxModel(model: string): string | undefined {
  return model === "fx/default" ? undefined : model;
}

const liveFxChildren = new Set<ChildProcess>();

export function createFxProcessRunner(
  options: FxProcessRunnerOptions = {},
  trackedChildren: Set<ChildProcess> = liveFxChildren,
): FxProcessRunner {
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

  const terminateChild = (
    child: ChildProcess,
    immediateKill = false,
  ): NodeJS.Timeout | undefined => {
    const existingTimer = terminationTimers.get(child);
    if (existingTimer) {
      if (!immediateKill) return existingTimer;
      clearTimeout(existingTimer);
      terminationTimers.delete(child);
    }
    signalChild(child, "SIGTERM");
    if (immediateKill) {
      signalChild(child, "SIGKILL");
      return undefined;
    }
    const timer = setTimeout(() => {
      terminationTimers.delete(child);
      signalChild(child, "SIGKILL");
    }, killGraceMs);
    terminationTimers.set(child, timer);
    timer.unref();
    return timer;
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

  return async (input) =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let stderrRemainder = "";
      let killTimer: NodeJS.Timeout | undefined;
      let child: ReturnType<typeof spawn>;

      const finish = (exitCode: number | null, signal?: string | null): void => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        input.signal.removeEventListener("abort", abort);
        if (stderrRemainder) input.onStderrLine?.(stderrRemainder);
        resolve({ stdout, stderr, exitCode, signal });
      };
      const abort = (): void => {
        if (!child || settled) return;
        killTimer = terminateChild(child);
      };

      try {
        registerHooks();
        child = spawnProcess(input.bin, input.args, {
          cwd: input.cwd,
          env: input.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        trackedChildren.add(child);
        child.stdout.on("data", (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk: Buffer | string) => {
          const text = String(chunk);
          stderr += text;
          const lines = `${stderrRemainder}${text}`.split(/\r?\n/u);
          stderrRemainder = lines.pop() ?? "";
          for (const line of lines) input.onStderrLine?.(line);
        });
        child.once("error", (error) => {
          untrackChild(child);
          stderr += `${stderr ? "\n" : ""}${stringifyError(error)}`;
          finish(null);
        });
        child.once("close", (exitCode, signal) => {
          untrackChild(child);
          finish(exitCode, signal);
        });
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
        child.stdin.end(input.stdin);
      } catch (error) {
        stderr += stringifyError(error);
        finish(null);
      }
    });
}

const defaultProcessRunner = createFxProcessRunner();

const defaultSessionStore: FxSessionStore = {
  async waitForSessionDir(home, signal) {
    if (signal.aborted) return undefined;
    const sessionsRoot = path.join(home, ".fx", "sessions");
    try {
      const entries = await fsp.readdir(sessionsRoot, { withFileTypes: true });
      const candidates = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name !== "latest" &&
            entry.name !== "index.pending" &&
            !entry.name.endsWith(".lock"),
        )
        .map((entry) => entry.name)
        .sort()
        .reverse();
      return candidates[0] ? path.join(sessionsRoot, candidates[0]) : undefined;
    } catch {
      return undefined;
    }
  },
  async readEventsJsonl(sessionDir) {
    try {
      return await fsp.readFile(path.join(sessionDir, "events.jsonl"), "utf8");
    } catch {
      return "";
    }
  },
  async readEventsJsonlChunk(sessionDir, offset) {
    let file: fsp.FileHandle | undefined;
    try {
      file = await fsp.open(path.join(sessionDir, "events.jsonl"), "r");
      const { size } = await file.stat();
      if (size <= offset) return { text: "", nextOffset: offset };
      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return {
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        nextOffset: offset + bytesRead,
      };
    } catch {
      return { text: "", nextOffset: offset };
    } finally {
      await file?.close().catch((): undefined => undefined);
    }
  },
  async readUsageSnapshot(sessionDir) {
    try {
      const text = await fsp.readFile(path.join(sessionDir, "usage-v2.json"), "utf8");
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
};

export async function runFxSession(input: {
  prompt: string;
  model?: string;
  bin?: string;
  cwd: string;
  home: string;
  env: Record<string, string>;
  permissionMode?: "auto" | "yolo";
  maxAgentSteps?: number;
  signal?: AbortSignal;
  logger: HarnessLogger;
  runProcess?: FxProcessRunner;
  store?: FxSessionStore;
  onToolStep?: (call: FxToolCallRecord) => void | Promise<void>;
  observedTool?: (name: string) => boolean;
  pollIntervalMs?: number;
}): Promise<FxSessionResult> {
  if (!input.cwd) throw new HarnessAdapterError("fx session requires cwd.");
  if (!input.home) throw new HarnessAdapterError("fx session requires home.");

  const events: FxEvent[] = [];
  const permissionMode = input.permissionMode ?? "auto";
  const args = ["ask", "--json", permissionMode === "yolo" ? "--yolo" : "--auto"];
  const model = input.model ? normalizeFxModel(input.model) : undefined;
  const env: Record<string, string> = {
    ...input.env,
    HOME: input.home,
    ...(model && { FX_MODEL: model }),
    ...(positiveInteger(input.maxAgentSteps) && {
      FX_MAX_AGENT_STEPS: String(Math.max(1, Math.floor(input.maxAgentSteps!))),
    }),
    FX_PERMISSION_MODE: permissionMode,
    FX_SKIP_ONBOARDING: "1",
    FX_AUTO_UPGRADE: "0",
    FX_NO_OPEN_BROWSER: "1",
    NO_COLOR: "1",
  };
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) controller.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const store = input.store ?? defaultSessionStore;
  const seenToolCalls = new Set<string>();
  const observedToolCallKeys: string[] = [];
  const observedTool = input.observedTool ?? ((name: string) => name.startsWith("mcp_"));
  let sessionDir: string | undefined;
  let eventsReadOffset = 0;
  let eventsLineRemainder = "";
  const incrementalLogEvents: FxLogEvent[] = [];
  let processSettled = false;
  let processResult: Awaited<ReturnType<FxProcessRunner>>;

  const notifyCalls = async (steps: FxToolStep[]): Promise<void> => {
    if (!input.onToolStep) return;
    for (const step of steps) {
      for (const call of step.tool_calls) {
        const id = typeof call.id === "string" ? call.id : undefined;
        const name = typeof call.name === "string" ? call.name : "";
        const key = id ?? `${name}:${call.arguments_json ?? ""}`;
        if (processSettled || !observedTool(name) || seenToolCalls.has(key)) continue;
        seenToolCalls.add(key);
        observedToolCallKeys.push(key);
        try {
          await input.onToolStep(call);
        } catch {
          // Live observation is best-effort and must never fail an fx run.
        }
      }
    }
  };

  const readNewLogEvents = async (final = false): Promise<FxLogEvent[]> => {
    if (!sessionDir) return [];
    const chunk = store.readEventsJsonlChunk
      ? await store.readEventsJsonlChunk(sessionDir, eventsReadOffset).catch(() => ({
          text: "",
          nextOffset: eventsReadOffset,
        }))
      : await store
          .readEventsJsonl(sessionDir)
          .then((text) => ({ text: text.slice(eventsReadOffset), nextOffset: text.length }))
          .catch(() => ({ text: "", nextOffset: eventsReadOffset }));
    eventsReadOffset = chunk.nextOffset;
    const combined = `${eventsLineRemainder}${chunk.text}`;
    const lastNewline = combined.lastIndexOf("\n");
    const completeText =
      final || lastNewline < 0 ? (final ? combined : "") : combined.slice(0, lastNewline + 1);
    eventsLineRemainder = final ? "" : lastNewline < 0 ? combined : combined.slice(lastNewline + 1);
    const parsed = parseFxEventsJsonl(completeText);
    incrementalLogEvents.push(...parsed);
    return parsed;
  };

  try {
    const processPromise = (input.runProcess ?? defaultProcessRunner)({
      bin: resolveFxBin(input.bin),
      args,
      cwd: input.cwd,
      env,
      stdin: input.prompt,
      signal: controller.signal,
    }).finally(() => {
      processSettled = true;
    });
    // Keep the rejection observed while the poll loop below is suspended in
    // delay()/waitForSessionDir — otherwise a spawn failure during the sleep
    // fires unhandledRejection and kills the worker. The real error still
    // surfaces at the `await processPromise` after the loop.
    processPromise.catch(() => {});

    if (input.onToolStep) {
      // fx does not stream tool events. Tail its recovery checkpoints only
      // while the process is alive.
      while (!processSettled && !controller.signal.aborted) {
        sessionDir ??= await store
          .waitForSessionDir(input.home, controller.signal)
          .catch(() => undefined);
        if (sessionDir) {
          await notifyCalls(extractFxToolSteps(await readNewLogEvents()));
        }
        if (!processSettled) {
          await delay(input.pollIntervalMs ?? 500, controller.signal);
        }
      }
    }
    processResult = await processPromise;
  } catch (error) {
    processResult = { stdout: "", stderr: stringifyError(error), exitCode: null };
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  for (const rawLine of processResult.stderr.split(/\r?\n/u)) {
    if (!rawLine) continue;
    const line = sanitizeErrorMessage(rawLine);
    const event: FxEvent = { type: "stderr", line };
    events.push(event);
    logFxEvent(input.logger, event);
  }

  const ask = parseFxAskOutput(processResult.stdout);
  sessionDir ??= await store
    .waitForSessionDir(input.home, controller.signal)
    .catch(() => undefined);
  if (sessionDir) await readNewLogEvents(true);
  const logEvents = incrementalLogEvents;
  const toolSteps = extractFxToolSteps(logEvents);
  for (const step of toolSteps) {
    const event: FxEvent = { type: "tool_step", ...step };
    events.push(event);
    logFxEvent(input.logger, event);
  }

  const committed = findLastCommittedTurn(logEvents);
  const turn = committed?.turn;
  const turnAssistant = typeof turn?.assistant === "string" ? turn.assistant : undefined;
  const finalMessage = typeof ask?.output === "string" ? ask.output : (turnAssistant ?? "");
  if (turnAssistant || finalMessage) {
    const event: FxEvent = { type: "assistant", text: turnAssistant ?? finalMessage };
    events.push(event);
    logFxEvent(input.logger, event);
  }
  const terminalReason =
    typeof turn?.terminal_reason === "string"
      ? turn.terminal_reason
      : typeof ask?.terminal_reason === "string"
        ? ask.terminal_reason
        : undefined;
  if (committed) {
    const event: FxEvent = {
      type: "turn_committed",
      ...(terminalReason && { terminal_reason: terminalReason }),
      ...(typeof turn?.kind === "string" && { turn_kind: turn.kind }),
    };
    events.push(event);
    logFxEvent(input.logger, event);
  }
  if (ask) {
    const event: FxEvent = { type: "ask_result", ask };
    events.push(event);
    logFxEvent(input.logger, event);
  }

  const usageSnapshot =
    sessionDir && store.readUsageSnapshot
      ? await store.readUsageSnapshot(sessionDir).catch(() => undefined)
      : undefined;
  const tokenUsage = extractFxTokenUsage(logEvents, usageSnapshot);
  const aborted = input.signal?.aborted === true;
  const configuredMaxAgentSteps = toPositiveInteger(env.FX_MAX_AGENT_STEPS);
  const observedToolSteps = Math.max(toolSteps.length, toPositiveInteger(ask?.steps) ?? 0);
  const resolution = resolveFxStatus({
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    ask,
    terminalReason,
    turnKind: typeof turn?.kind === "string" ? turn.kind : undefined,
    assistantText: turnAssistant,
    observedToolSteps,
    maxAgentSteps: configuredMaxAgentSteps,
    aborted,
    stderr: processResult.stderr,
  });
  const stopReason = resolution.stopReason
    ? sanitizeErrorMessage(resolution.stopReason)
    : undefined;
  let iterationError: unknown;
  if (resolution.status !== "completed") {
    iterationError = new HarnessAdapterError(stopReason ?? "fx stopped before a normal result");
    input.logger.warn({
      category: "fx",
      message: `fx stopped before a normal result: ${stopReason ?? "unknown error"}`,
      level: 0,
      auxiliary: {
        error: { value: stopReason ?? "unknown error", type: "string" },
      },
    });
  }

  return {
    events,
    finalMessage,
    status: resolution.status,
    ...(stopReason && { stopReason }),
    tokenUsage,
    ...(typeof ask?.session_id === "string" && { sessionId: ask.session_id }),
    ...(processResult.exitCode !== null && { exitCode: processResult.exitCode }),
    ...(iterationError !== undefined && { iterationError }),
    observedToolCallKeys,
  };
}

export function parseFxAskOutput(stdout: string): FxAskOutput | undefined {
  if (!stdout.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    return isRecord(parsed) ? (parsed as FxAskOutput) : undefined;
  } catch {
    return undefined;
  }
}

export function parseFxEventsJsonl(text: string): FxLogEvent[] {
  const events: FxLogEvent[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) events.push(parsed as FxLogEvent);
    } catch {
      // A partially written final line is normal while tailing events.jsonl.
    }
  }
  return events;
}

export function extractFxToolSteps(events: FxLogEvent[]): FxToolStep[] {
  let checkpointSteps: FxToolStep[] = [];
  let committedSteps: FxToolStep[] | undefined;
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    if (event.kind === "recovery_checkpoint_set") {
      const checkpoint = isRecord(payload?.checkpoint) ? payload.checkpoint : undefined;
      const execution = isRecord(checkpoint?.execution) ? checkpoint.execution : undefined;
      checkpointSteps = readToolSteps(execution?.tool_steps);
    } else if (event.kind === "history_turn_committed") {
      const turn = isRecord(payload?.turn) ? payload.turn : undefined;
      const execution = isRecord(turn?.execution) ? turn.execution : undefined;
      committedSteps = readToolSteps(execution?.tool_steps);
    }
  }
  return committedSteps ?? checkpointSteps;
}

export function extractFxTokenUsage(
  events: FxLogEvent[],
  usageSnapshot?: Record<string, unknown>,
): FxTokenUsage {
  const snapshot = isRecord(usageSnapshot?.snapshot) ? usageSnapshot.snapshot : usageSnapshot;
  if (snapshot && hasUsageFields(snapshot)) return usageFromRecord(snapshot);

  const committed = findLastCommittedTurn(events);
  if (committed) {
    return {
      input_tokens: toFiniteNumber(committed.payload.total_input_tokens),
      cached_input_tokens: 0,
      output_tokens: toFiniteNumber(committed.payload.total_output_tokens),
      reasoning_output_tokens: 0,
    };
  }

  let lastUsage: Record<string, unknown> | undefined;
  for (const event of events) {
    if (event.kind !== "usage_checkpointed" || !isRecord(event.payload)) continue;
    if (isRecord(event.payload.usage)) lastUsage = event.payload.usage;
  }
  return usageFromRecord(lastUsage);
}

export function resolveFxStatus(input: {
  exitCode: number | null;
  signal?: string | null;
  ask?: FxAskOutput;
  terminalReason?: string;
  turnKind?: string;
  assistantText?: string;
  observedToolSteps?: number;
  maxAgentSteps?: number;
  aborted?: boolean;
  stderr?: string;
}): { status: "completed" | "max_turns" | "sdk_error"; stopReason?: string } {
  if (input.aborted) return { status: "sdk_error", stopReason: "aborted" };
  if (input.exitCode === 130 || input.signal) {
    return { status: "sdk_error", stopReason: "interrupted" };
  }
  const error = typeof input.ask?.error === "string" ? input.ask.error : undefined;
  const stepLimitNotice = [input.assistantText, input.ask?.output].find(
    (value): value is string =>
      typeof value === "string" && /agent step limit reached/iu.test(value),
  );
  if (
    stepLimitNotice ||
    input.terminalReason === "step_limit" ||
    input.terminalReason === "step_limit_reached" ||
    (error && /step.?limit/iu.test(error))
  ) {
    return {
      status: "max_turns",
      stopReason: stepLimitNotice ?? error ?? input.terminalReason,
    };
  }
  // Bare step-count heuristic: only a fallback for silent stops (fx reports
  // terminal_reason "completed" even when it halts at its budget). A run
  // that succeeded outright — exit 0 on both the process and the ask, no
  // error — must not be fabricated into a budget failure just because it
  // finished on exactly its last allowed step.
  const succeededOutright =
    input.exitCode === 0 && !error && (input.ask?.exit_code === 0 || input.ask?.exit_code == null);
  const reachedConfiguredStepLimit =
    positiveInteger(input.maxAgentSteps) &&
    typeof input.observedToolSteps === "number" &&
    input.observedToolSteps >= input.maxAgentSteps;
  if (reachedConfiguredStepLimit && !succeededOutright) {
    return {
      status: "max_turns",
      stopReason: `fx reached the configured agent step limit (${input.maxAgentSteps} steps)`,
    };
  }
  if (!input.ask) {
    const stderr = input.stderr?.trim();
    return {
      status: "sdk_error",
      stopReason: `fx produced no JSON output${stderr ? `: ${clip(sanitizeErrorMessage(stderr), 500)}` : ""}`,
    };
  }
  if (error) return { status: "sdk_error", stopReason: error };
  if (typeof input.ask.exit_code === "number" && input.ask.exit_code !== 0) {
    return {
      status: "sdk_error",
      stopReason: `fx reported exit_code ${input.ask.exit_code}`,
    };
  }
  const failurePattern =
    /^(cancel|interrupt|error|fail|abort|timeout|deadline|terminat|unreadable)/iu;
  const failedTurn = [input.terminalReason, input.turnKind].find(
    (value): value is string => typeof value === "string" && failurePattern.test(value),
  );
  if (failedTurn) {
    return { status: "sdk_error", stopReason: `fx turn ended: ${failedTurn}` };
  }
  if (input.exitCode === 0) return { status: "completed" };
  return {
    status: "sdk_error",
    stopReason: `fx exited with code ${input.exitCode ?? "unknown"}`,
  };
}

export function buildFxTranscript(events: FxEvent[]): string {
  return events
    .map((event) => summarizeFxEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logFxEvent(logger: HarnessLogger, event: FxEvent): void {
  const summary = summarizeFxEvent(event);
  logger.log({
    category: "fx",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: event.type, type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeFxEvent(event: FxEvent): { message: string; detail?: string } {
  let summary: { message: string; detail?: string };
  if (event.type === "assistant") {
    summary = {
      message: `assistant: ${clip(sanitizeErrorMessage(event.text), 500)}`,
      detail: event.text,
    };
  } else if (event.type === "tool_step") {
    const names = event.tool_calls.map((call) => String(call.name ?? "tool")).join(", ");
    summary = { message: `tools: ${names}`, detail: safeJson(event) };
  } else if (event.type === "stderr") {
    summary = {
      message: `stderr: ${clip(sanitizeErrorMessage(event.line), 500)}`,
      detail: event.line,
    };
  } else if (event.type === "turn_committed") {
    summary = {
      message: `turn committed: ${event.terminal_reason ?? event.turn_kind ?? "unknown"}`,
      detail: safeJson(event),
    };
  } else {
    summary = { message: "ask result", detail: safeJson(event.ask) };
  }
  return {
    message: sanitizeErrorMessage(summary.message),
    ...(summary.detail && { detail: sanitizeErrorMessage(summary.detail) }),
  };
}

function readToolSteps(value: unknown): FxToolStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((step) => ({
    assistant: typeof step.assistant === "string" ? step.assistant : "",
    tool_calls: Array.isArray(step.tool_calls)
      ? step.tool_calls.filter(isRecord).map((call) => call as FxToolCallRecord)
      : [],
    tool_results: Array.isArray(step.tool_results)
      ? step.tool_results.filter(isRecord).map((result) => result as FxToolResultRecord)
      : [],
  }));
}

function findLastCommittedTurn(
  events: FxLogEvent[],
): { payload: Record<string, unknown>; turn?: Record<string, unknown> } | undefined {
  let found: { payload: Record<string, unknown>; turn?: Record<string, unknown> } | undefined;
  for (const event of events) {
    if (event.kind !== "history_turn_committed" || !isRecord(event.payload)) continue;
    found = {
      payload: event.payload,
      ...(isRecord(event.payload.turn) && { turn: event.payload.turn }),
    };
  }
  return found;
}

function hasUsageFields(record: Record<string, unknown>): boolean {
  return [
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "reasoning_tokens",
    "total_cost",
  ].some((key) => key in record);
}

function usageFromRecord(record?: Record<string, unknown>): FxTokenUsage {
  return {
    input_tokens: toFiniteNumber(record?.input_tokens),
    cached_input_tokens: toFiniteNumber(record?.cache_read_tokens),
    output_tokens: toFiniteNumber(record?.output_tokens),
    reasoning_output_tokens: toFiniteNumber(record?.reasoning_tokens),
    ...(record &&
      "total_cost" in record && {
        total_cost: toFiniteNumber(record.total_cost),
      }),
  };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
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
  return safeJson(value) ?? Object.prototype.toString.call(value);
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
