import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  HarnessAdapterError,
  harnessEventLogLevel,
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
  /** fx >= 0.0.11 stores the full output in `<session>/tool-results/<output_handle>`. */
  output_handle?: string;
  /** Screenshot results keep their image blocks in a separate artifact. */
  tool_image_handle?: string;
  preview?: string;
  [key: string]: unknown;
};

export type FxAskOutput = {
  /** Every assistant message of the turn joined together (narration included). */
  output?: string;
  /** fx >= 0.0.11: only the completed final response, or "" when absent. */
  final_output?: string;
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
  /** Whether token counters were observed; false distinguishes missing telemetry from zero. */
  reported?: boolean;
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
  /**
   * fx >= 0.0.11 keeps the in-flight turn in `recovery.json` and only writes
   * events.jsonl once the turn completes (the file is removed on commit).
   */
  readRecoveryCheckpoint?(sessionDir: string): Promise<Record<string, unknown> | undefined>;
  /** Read a `tool-results/` artifact referenced by a tool result, capped at maxBytes. */
  readToolResultArtifact?(
    sessionDir: string,
    ref: string,
    maxBytes: number,
  ): Promise<string | undefined>;
  /** Merge session defaults into `$HOME/.fx/settings.json` so session.json records them. */
  mergeSettings?(home: string, patch: Record<string, unknown>): Promise<void>;
};

export const FX_BIN_ENV = "EVAL_FX_PATH";

export function resolveFxBin(override?: string): string {
  return override ?? process.env[FX_BIN_ENV] ?? "fx";
}

/**
 * Map an eval model id onto the id fx resolves against the AI Gateway catalog.
 * fx looks the model up in the catalog to decide whether to send `reasoning`
 * and `maxOutputTokens`: an id the catalog lacks (`anthropic/claude-sonnet-5-5`
 * instead of `anthropic/claude-sonnet-5.5`) still routes, but fx silently drops
 * the requested effort and the output-token ceiling.
 */
export function normalizeFxModel(model: string): string | undefined {
  if (model === "fx/default") return undefined;
  const dashedAnthropic = /^(anthropic\/claude-[a-z]+-\d+)-(\d)$/u.exec(model);
  return dashedAnthropic ? `${dashedAnthropic[1]}.${dashedAnthropic[2]}` : model;
}

/**
 * Reasoning efforts fx understands. fx accepts any string for `--effort` and
 * silently sends no reasoning parameter for one it does not know, so reject
 * unknown values before spending a run on them. Per-model availability is
 * still decided by fx (e.g. Sonnet 5.5 offers low..max).
 */
export const FX_REASONING_EFFORTS = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type FxReasoningEffort = (typeof FX_REASONING_EFFORTS)[number];

/** Validate a requested fx reasoning effort; empty/undefined means fx's default. */
export function parseFxReasoningEffort(
  raw: string | undefined,
  source = "fx reasoning effort",
): FxReasoningEffort | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if ((FX_REASONING_EFFORTS as readonly string[]).includes(value)) {
    return value as FxReasoningEffort;
  }
  throw new HarnessAdapterError(`${source} must be one of ${FX_REASONING_EFFORTS.join(", ")}.`);
}

/** Largest tool-result artifact inlined into a step; larger outputs are clipped. */
export const FX_TOOL_RESULT_MAX_BYTES = 512 * 1024;
// Screenshots need more room than text output; keep the artifact read bounded.
const FX_IMAGE_RESULT_MAX_BYTES = 20 * 1024 * 1024;

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
  async readRecoveryCheckpoint(sessionDir) {
    try {
      const text = await fsp.readFile(path.join(sessionDir, "recovery.json"), "utf8");
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      // Missing (turn committed) or caught mid-rewrite; the next poll retries.
      return undefined;
    }
  },
  async readToolResultArtifact(sessionDir, ref, maxBytes) {
    // Artifact refs are bare file names; never follow one out of tool-results/.
    if (!ref || ref !== path.basename(ref)) return undefined;
    let file: fsp.FileHandle | undefined;
    try {
      file = await fsp.open(path.join(sessionDir, "tool-results", ref), "r");
      const { size } = await file.stat();
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      return size > maxBytes ? `${text}\n[fx tool output truncated: ${size} bytes]` : text;
    } catch {
      return undefined;
    } finally {
      await file?.close().catch((): undefined => undefined);
    }
  },
  async mergeSettings(home, patch) {
    const settingsPath = path.join(home, ".fx", "settings.json");
    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
      if (isRecord(parsed)) current = parsed;
    } catch {
      // No settings yet.
    }
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
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
  /** Passed as `fx ask --effort`; undefined leaves fx's per-model default. */
  reasoningEffort?: FxReasoningEffort;
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
  const model = input.model ? normalizeFxModel(input.model) : undefined;
  const reasoningEffort = parseFxReasoningEffort(input.reasoningEffort);
  // FX_MODEL alone is not recorded in session.json and does not reach fx's
  // catalog lookup for request options; pass the per-request flags explicitly.
  const args = [
    "ask",
    "--json",
    permissionMode === "yolo" ? "--yolo" : "--auto",
    ...(model ? ["--model", model] : []),
    ...(reasoningEffort ? ["--effort", reasoningEffort] : []),
  ];
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
  if (store.mergeSettings && (model || reasoningEffort)) {
    // Per-request flags are not persisted; session defaults make session.json
    // record the model and effort the run actually used.
    await store
      .mergeSettings(input.home, {
        ...(model && { model }),
        ...(reasoningEffort && { effort: reasoningEffort }),
      })
      .catch((error: unknown) => {
        input.logger.warn({
          category: "fx",
          message: `could not record fx session defaults: ${sanitizeErrorMessage(stringifyError(error))}`,
          level: 1,
        });
      });
  }
  const seenToolCalls = new Set<string>();
  const observedToolCallKeys: string[] = [];
  const observedTool = input.observedTool ?? ((name: string) => name.startsWith("mcp_"));
  let sessionDir: string | undefined;
  let eventsReadOffset = 0;
  let eventsLineRemainder = "";
  const incrementalLogEvents: FxLogEvent[] = [];
  let lastRecoverySteps: FxToolStep[] = [];
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

  const readRecoverySteps = async (): Promise<FxToolStep[]> => {
    if (!sessionDir || !store.readRecoveryCheckpoint) return [];
    const recovery = await store.readRecoveryCheckpoint(sessionDir).catch(() => undefined);
    const steps = extractFxRecoverySteps(recovery);
    // recovery.json disappears when the turn commits; keep the last one seen
    // so a run killed mid-turn still reports the steps it took.
    if (steps.length >= lastRecoverySteps.length && steps.length > 0) lastRecoverySteps = steps;
    return steps;
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
          await notifyCalls(await readRecoverySteps());
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
  if (sessionDir) {
    await readNewLogEvents(true);
    await readRecoverySteps();
  }
  const logEvents = incrementalLogEvents;
  // events.jsonl carries the committed turn. When it is empty (fx >= 0.0.11
  // killed or timed out mid-turn), the last recovery checkpoint is the only
  // record of the steps the agent took.
  let toolSteps = extractFxToolSteps(logEvents);
  if (toolSteps.length === 0) toolSteps = lastRecoverySteps;
  if (sessionDir && store.readToolResultArtifact) {
    toolSteps = await hydrateFxToolResults(toolSteps, (ref, maxBytes) =>
      store.readToolResultArtifact!(sessionDir!, ref, maxBytes),
    );
  }
  for (const step of toolSteps) {
    const event: FxEvent = { type: "tool_step", ...step };
    events.push(event);
    logFxEvent(input.logger, event);
  }

  const committed = findLastCommittedTurn(logEvents);
  const turn = committed?.turn;
  const turnAssistant =
    typeof turn?.assistant === "string" ? turn.assistant : extractFxFinalAssistant(logEvents);
  // `ask.output` is every assistant message of the turn joined together —
  // opening narration, interstitial commentary and the conclusion — while
  // `ask.final_output` (fx >= 0.0.11) and the committed turn's final assistant
  // message are the conclusion alone. The narration belongs to the tool steps
  // that carry it, so the final message must be the latter.
  const finalOutput = typeof ask?.final_output === "string" ? ask.final_output : undefined;
  const finalMessage = finalOutput?.trim()
    ? finalOutput
    : turnAssistant?.trim()
      ? turnAssistant
      : typeof ask?.output === "string"
        ? ask.output
        : "";
  if (finalMessage) {
    const event: FxEvent = { type: "assistant", text: finalMessage };
    events.push(event);
    logFxEvent(input.logger, event);
  }
  const terminalReason =
    typeof turn?.terminal_reason === "string"
      ? turn.terminal_reason
      : typeof ask?.terminal_reason === "string"
        ? ask.terminal_reason
        : undefined;
  const turnCompleted = committed !== undefined || hasFxTurnCompleted(logEvents);
  if (turnCompleted) {
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
  if (events.some(isFxStreamEvent)) return extractFxStreamToolSteps(events);
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

/**
 * fx >= 0.0.11 writes events.jsonl as a flat stream (schema_version 3):
 * `{seq, timestamp_ms, event: {user|assistant|tool_call|tool_result|turn_completed: {...}}}`.
 * Older fx wrote `{kind, payload}` records with whole checkpoints.
 */
function isFxStreamEvent(event: FxLogEvent): boolean {
  return isRecord(event.event) && event.kind === undefined;
}

function fxStreamPayload(
  event: FxLogEvent,
): { type: string; body: Record<string, unknown> } | undefined {
  if (!isRecord(event.event)) return undefined;
  const [type] = Object.keys(event.event);
  const body = type ? event.event[type] : undefined;
  return type && isRecord(body) ? { type, body } : undefined;
}

function extractFxStreamToolSteps(events: FxLogEvent[]): FxToolStep[] {
  const steps: FxToolStep[] = [];
  const stepByCallId = new Map<string, FxToolStep>();
  let pendingAssistant = "";
  let current: FxToolStep | undefined;
  for (const event of events) {
    const payload = fxStreamPayload(event);
    if (!payload) continue;
    const { type, body } = payload;
    if (type === "user" || type === "turn_completed") {
      pendingAssistant = "";
      current = undefined;
    } else if (type === "assistant") {
      pendingAssistant = typeof body.text === "string" ? body.text : "";
      current = undefined;
    } else if (type === "tool_call") {
      if (!current) {
        current = { assistant: pendingAssistant, tool_calls: [], tool_results: [] };
        steps.push(current);
        pendingAssistant = "";
      }
      const id = typeof body.call_id === "string" ? body.call_id : undefined;
      current.tool_calls.push({
        ...(id && { id }),
        ...(typeof body.tool_name === "string" && { name: body.tool_name }),
        ...(typeof body.arguments_json === "string" && { arguments_json: body.arguments_json }),
        ...(body.provider_result !== undefined && { provider_result: body.provider_result }),
      });
      if (id) stepByCallId.set(id, current);
    } else if (type === "tool_result") {
      const id = typeof body.call_id === "string" ? body.call_id : undefined;
      const step = (id && stepByCallId.get(id)) || current || steps.at(-1);
      if (!step) continue;
      step.tool_results.push({
        ...(id && { tool_call_id: id }),
        ...(typeof body.tool_name === "string" && { tool_name: body.tool_name }),
        ...(typeof body.status === "string" && { status: body.status }),
        output: typeof body.output === "string" ? body.output : "",
        ...(typeof body.artifact_ref === "string" && { output_handle: body.artifact_ref }),
        ...(typeof body.tool_image_handle === "string" && {
          tool_image_handle: body.tool_image_handle,
        }),
        ...(typeof body.preview === "string" && { preview: body.preview }),
        truncated: typeof body.completeness === "string" && body.completeness !== "complete",
      });
    }
  }
  return steps;
}

/** The last assistant message of the stream that no tool call followed: the turn's conclusion. */
export function extractFxFinalAssistant(events: FxLogEvent[]): string | undefined {
  let final: string | undefined;
  for (const event of events) {
    const payload = fxStreamPayload(event);
    if (!payload) continue;
    if (payload.type === "assistant") {
      final = typeof payload.body.text === "string" ? payload.body.text : undefined;
    } else if (payload.type === "tool_call" || payload.type === "user") {
      final = undefined;
    }
  }
  return final;
}

function hasFxTurnCompleted(events: FxLogEvent[]): boolean {
  return events.some((event) => fxStreamPayload(event)?.type === "turn_completed");
}

/** Tool steps of the in-flight turn from fx >= 0.0.11 `recovery.json`. */
export function extractFxRecoverySteps(
  recovery: Record<string, unknown> | undefined,
): FxToolStep[] {
  const checkpoint = isRecord(recovery?.checkpoint) ? recovery.checkpoint : undefined;
  const execution = isRecord(checkpoint?.execution) ? checkpoint.execution : undefined;
  return readToolSteps(execution?.tool_steps);
}

/**
 * fx >= 0.0.11 leaves `output` empty and stores the full text in a
 * `tool-results/` artifact, with screenshot image blocks in a second artifact.
 * Inline both so the trajectory carries the evidence the agent saw.
 */
export async function hydrateFxToolResults(
  steps: FxToolStep[],
  readArtifact: (ref: string, maxBytes: number) => Promise<string | undefined>,
  maxBytes = FX_TOOL_RESULT_MAX_BYTES,
): Promise<FxToolStep[]> {
  const read = (ref: string) => readArtifact(ref, maxBytes).catch((): undefined => undefined);
  return Promise.all(
    steps.map(async (step) => ({
      ...step,
      tool_results: await Promise.all(
        step.tool_results.map(async (result) => {
          let output = typeof result.output === "string" ? result.output : "";
          if (!output && typeof result.output_handle === "string") {
            output = (await read(result.output_handle)) ?? "";
          }
          if (!output && typeof result.preview === "string") output = result.preview;
          if (typeof result.tool_image_handle === "string") {
            output = mergeFxImageBlocks(
              output,
              await readArtifact(result.tool_image_handle, FX_IMAGE_RESULT_MAX_BYTES).catch(
                () => undefined,
              ),
            );
          }
          return { ...result, output };
        }),
      ),
    })),
  );
}

/** Fill the data-less image placeholders of an MCP result with the stored image blocks. */
function mergeFxImageBlocks(output: string, imagesText: string | undefined): string {
  if (!imagesText) return output;
  let images: unknown;
  let parsedOutput: unknown;
  try {
    images = JSON.parse(imagesText);
    parsedOutput = JSON.parse(output);
  } catch {
    return output;
  }
  if (!Array.isArray(images)) return output;
  const queue = images.filter(
    (block): block is Record<string, unknown> =>
      isRecord(block) && block.type === "image" && typeof block.data === "string",
  );
  if (queue.length === 0) return output;
  const fill = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(fill);
    if (!isRecord(value)) return value;
    if (value.type === "image" && typeof value.data !== "string") {
      const block = queue.shift();
      if (!block) return value;
      return { type: "image", mimeType: block.mimeType ?? value.mimeType, data: block.data };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
  };
  return safeJson(fill(parsedOutput)) ?? output;
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
      reported: [committed.payload.total_input_tokens, committed.payload.total_output_tokens].some(
        isTokenCount,
      ),
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
  const level = harnessEventLogLevel(event.type, {
    isError:
      (event.type === "stderr" && /\b(?:error|fatal|failed|panic)\b/iu.test(event.line)) ||
      (event.type === "tool_step" &&
        event.tool_results.some((result) =>
          /^(?:error|failed|failure)$/iu.test(result.status ?? ""),
        )) ||
      (event.type === "ask_result" &&
        typeof event.ask.error === "string" &&
        event.ask.error.length > 0),
    hasContent: true,
  });
  if (level === undefined) return;
  const summary = summarizeFxEvent(event);
  logger.log({
    category: "fx",
    message: summary.message,
    level,
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
    reported: [record?.input_tokens, record?.output_tokens].some(isTokenCount),
    input_tokens: toFiniteNumber(record?.input_tokens),
    cached_input_tokens: toFiniteNumber(record?.cache_read_tokens),
    output_tokens: toFiniteNumber(record?.output_tokens),
    reasoning_output_tokens: toFiniteNumber(record?.reasoning_tokens),
    ...(typeof record?.total_cost === "number" &&
      Number.isFinite(record.total_cost) &&
      record.total_cost >= 0 && {
        total_cost: record.total_cost,
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

function isTokenCount(value: unknown): boolean {
  return (
    ((typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)))) &&
    Number(value) >= 0
  );
}
