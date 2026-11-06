import { join } from "node:path";
import { Agent, JsonlLocalAgentStore, type AgentOptions } from "@cursor/sdk";
import {
  sanitizeErrorMessage,
  harnessEventLogLevel,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import { extractCursorToolCall } from "./events.js";

export type CursorSdkEvent = Record<string, unknown>;
export type CursorSdkRunResult = {
  status?: string;
  result?: unknown;
  error?: unknown;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
};
export type CursorSdkAgent = {
  run?: (prompt: string) => PromiseLike<CursorSdkRun> | CursorSdkRun;
  send?: (prompt: string) => PromiseLike<CursorSdkRun> | CursorSdkRun;
  close?: () => void | Promise<void>;
  [Symbol.asyncDispose]?: () => Promise<void>;
  [key: string]: unknown;
};
export type CursorSdkRun = {
  wait: () => Promise<CursorSdkRunResult>;
  cancel?: () => Promise<void>;
  stream?: () => AsyncIterable<unknown>;
  [key: string]: unknown;
};
export type CursorSdkAgentFactory = (options: AgentOptions) => Promise<CursorSdkAgent>;

export interface CursorSdkSessionInput {
  prompt: string;
  /** Explicit key for hosts with an isolated environment; empty suppresses ambient fallback. */
  apiKey?: string;
  model: string;
  cwd: string;
  mcpServers: Record<string, unknown>;
  logger: HarnessLogger;
  signal?: AbortSignal;
  createAgent?: CursorSdkAgentFactory;
  maxToolSteps?: number;
  onToolResult?: (toolName: string) => void | Promise<void>;
}

export interface CursorSdkSessionResult {
  events: CursorSdkEvent[];
  resultText: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reported: boolean;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    reasoningOutputTokens?: number;
  };
  raw: CursorSdkRunResult;
  iterationError?: unknown;
  costUsd?: number;
}

const defaultCreateAgent: CursorSdkAgentFactory = async (options) => {
  if (typeof options.apiKey !== "string" || !options.apiKey.trim()) {
    throw new Error("CURSOR_API_KEY is required for the Cursor SDK harness.");
  }
  return (await Agent.create(options)) as unknown as CursorSdkAgent;
};

export async function runCursorSdkAgentSession(
  input: CursorSdkSessionInput,
): Promise<CursorSdkSessionResult> {
  if (Object.keys(input.mcpServers).length === 0) {
    throw new Error("Cursor SDK requires a supplied shared MCP mount.");
  }
  const createAgent = input.createAgent ?? defaultCreateAgent;
  const options = {
    apiKey: input.apiKey ?? process.env.CURSOR_API_KEY,
    model: { id: normalizeModel(input.model) },
    local: {
      cwd: input.cwd,
      settingSources: [],
      store: new JsonlLocalAgentStore(join(input.cwd, ".cursor-sdk-store")),
    },
    tools: ["mcp"],
    mcpServers: input.mcpServers,
  } as unknown as AgentOptions;
  const events: CursorSdkEvent[] = [];
  let agent: CursorSdkAgent | undefined;
  let run: CursorSdkRun | undefined;
  let iterator: AsyncIterator<unknown> | undefined;
  let raw: CursorSdkRunResult = { status: "error" };
  let iterationError: unknown;
  let budgetStopReason: string | undefined;
  let completedTools = 0;
  const warn = (error: unknown): void => {
    input.logger.warn({
      category: "cursor",
      level: 1,
      message: sanitizeErrorMessage(stringify(error)),
    });
  };
  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    agent = await acquireAbortably(createAgent(options), input.signal, (lateAgent) =>
      disposeAgent(lateAgent, warn),
    );
    if (input.signal?.aborted) throw abortReason(input.signal);
    const send = agent.send ?? agent.run;
    if (!send) throw new Error("Cursor SDK agent does not expose send().");
    const sendingAgent = agent;
    run = await acquireAbortably(
      Promise.resolve(send.call(sendingAgent, input.prompt)),
      input.signal,
      async (lateRun) => {
        try {
          await cancelRun(lateRun, warn);
        } finally {
          // send() can acquire an executor after the first abort cleanup.
          await disposeAgent(sendingAgent, warn);
        }
      },
      () => disposeAgent(sendingAgent, warn),
    );
    if (input.signal?.aborted) throw abortReason(input.signal);
    if (run.stream) {
      iterator = run.stream()[Symbol.asyncIterator]();
      while (true) {
        const next = await abortable(iterator.next(), input.signal);
        if (next.done) break;
        if (!isRecord(next.value)) continue;
        const normalized = normalizeSdkEvent(next.value);
        events.push(normalized);
        logSdkEvent(normalized, input.logger);
        const view = extractCursorToolCall(normalized);
        if (view?.subtype === "completed") {
          completedTools += 1;
          await abortable(Promise.resolve(input.onToolResult?.(view.name)), input.signal);
          if (input.maxToolSteps && completedTools >= input.maxToolSteps) {
            budgetStopReason = `tool step budget exhausted (${input.maxToolSteps} steps)`;
            break;
          }
        }
      }
    }
    if (!budgetStopReason) {
      raw = await within(abortable(run.wait(), input.signal), 30_000, "terminal wait");
    }
  } catch (error) {
    iterationError = error;
    warn(error);
  } finally {
    if (run && (budgetStopReason || iterationError !== undefined || input.signal?.aborted)) {
      raw = (await cancelRun(run, warn)) ?? raw;
    }
    // A pending SDK next() may ignore cancellation. Do not let iterator cleanup
    // hold the task open after the bounded cancellation/terminal wait above.
    if (iterator?.return)
      void Promise.resolve()
        .then(() => iterator!.return!())
        .catch(warn);
    if (agent) await disposeAgent(agent, warn);
  }
  const usage = usageFrom(raw.usage);
  const resultText = typeof raw.result === "string" ? raw.result : extractText(raw.result);
  const stopReason =
    budgetStopReason ??
    (input.signal?.aborted ? stringify(abortReason(input.signal)) : undefined) ??
    (iterationError !== undefined ? stringify(iterationError) : undefined) ??
    (raw.error !== undefined ? stringify(raw.error) : undefined) ??
    (raw.status === "cancelled" ? "Cursor SDK run cancelled" : undefined);
  const status = budgetStopReason
    ? "max_turns"
    : stopReason || raw.status === "error"
      ? "sdk_error"
      : "completed";
  return {
    events,
    resultText,
    status,
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    ...((iterationError ?? raw.error) !== undefined && {
      iterationError: iterationError ?? raw.error,
    }),
    tokenUsage: usage,
    raw,
    ...(typeof raw.costUsd === "number" && { costUsd: raw.costUsd }),
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Cursor SDK session aborted");
}

/** SDK bootstrap has no AbortSignal API; release resources that arrive after abort. */
async function acquireAbortably<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
  releaseLate: (value: T) => Promise<void>,
  releaseFailedLate?: () => Promise<void>,
): Promise<T> {
  try {
    const value = await abortable(pending, signal);
    if (signal?.aborted) throw abortReason(signal);
    return value;
  } catch (error) {
    // The caller can finish immediately. A late resolution still owns cleanup;
    // both cleanup callbacks below bound and log their own failures.
    if (signal?.aborted) {
      void pending.then(releaseLate, releaseFailedLate).catch(() => {});
    }
    throw error;
  }
}

async function cancelRun(
  run: CursorSdkRun,
  warn: (error: unknown) => void,
): Promise<CursorSdkRunResult | undefined> {
  await within(
    Promise.resolve().then(() => run.cancel?.()),
    5_000,
    "cancellation",
  ).catch(warn);
  return within(
    Promise.resolve().then(() => run.wait()),
    5_000,
    "cancelled run wait",
  ).catch((error) => {
    warn(error);
    return undefined;
  });
}

async function disposeAgent(agent: CursorSdkAgent, warn: (error: unknown) => void): Promise<void> {
  const dispose = agent[Symbol.asyncDispose];
  if (dispose) {
    await within(
      Promise.resolve().then(() => dispose.call(agent)),
      5_000,
      "agent disposal",
    ).catch((error) => {
      warn(error);
      // close() initiates executor release even if asyncDispose stalled
      // while flushing telemetry before reaching that release.
      void Promise.resolve()
        .then(() => agent.close?.())
        .catch(warn);
    });
  } else {
    await within(
      Promise.resolve().then(() => agent.close?.()),
      5_000,
      "agent close",
    ).catch(warn);
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const removeAbort = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      removeAbort();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        removeAbort();
        resolve(value);
      },
      (error) => {
        removeAbort();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function within<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Cursor SDK ${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeModel(model: string): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

function usageFrom(raw: Record<string, unknown> | undefined) {
  const inputTokens = number(raw?.inputTokens ?? raw?.input_tokens);
  const outputTokens = number(raw?.outputTokens ?? raw?.output_tokens);
  const totalTokens = number(raw?.totalTokens ?? raw?.total_tokens) || inputTokens + outputTokens;
  const cachedInputTokens = number(raw?.cacheReadTokens ?? raw?.cachedInputTokens);
  const cacheCreationInputTokens = number(raw?.cacheWriteTokens ?? raw?.cacheCreationInputTokens);
  const reasoningOutputTokens = number(raw?.reasoningTokens ?? raw?.reasoningOutputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningOutputTokens,
    reported: [
      raw?.inputTokens,
      raw?.input_tokens,
      raw?.outputTokens,
      raw?.output_tokens,
      raw?.totalTokens,
      raw?.total_tokens,
      raw?.cacheReadTokens,
      raw?.cachedInputTokens,
      raw?.cacheWriteTokens,
      raw?.cacheCreationInputTokens,
      raw?.reasoningTokens,
      raw?.reasoningOutputTokens,
    ].some((value) => typeof value === "number" && Number.isFinite(value) && value >= 0),
  };
}

function normalizeSdkEvent(event: Record<string, unknown>): CursorSdkEvent {
  if (event.type === "thinking") {
    return {
      ...event,
      subtype:
        event.text === "" && event.thinking_duration_ms !== undefined ? "completed" : "delta",
    };
  }
  if (event.type !== "tool_call") return event;
  const status =
    event.status === "completed" ||
    event.status === "error" ||
    event.status === "success" ||
    event.status === "finished"
      ? "completed"
      : "started";
  const rawArgs = isRecord(event.args) ? event.args : {};
  // MCP tool calls arrive with the capability group in `name` ("mcp") and the
  // real tool in `args.{providerIdentifier,toolName}`. Surface the concrete
  // `<server>.<tool>` name so the verifier's facade-tool gate (no_browser_use)
  // and observation matcher recognize browser usage. Non-MCP tools keep name.
  const name = typeof event.name === "string" ? event.name : "mcp.tool";
  const result =
    event.status === "error"
      ? { error: event.result ?? "Cursor SDK tool call failed" }
      : event.result !== undefined
        ? { success: event.result }
        : undefined;
  const call = { args: rawArgs, ...(result && { result }) };
  const normalized = {
    ...event,
    subtype: status,
    call_id: String(event.call_id ?? ""),
    tool_call:
      name === "mcp"
        ? { mcpToolCall: call }
        : { function: { name, arguments: JSON.stringify(rawArgs), ...call } },
  };
  return { ...normalized, name: extractCursorToolCall(normalized)?.name ?? name };
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function extractText(value: unknown): string {
  return typeof value === "string"
    ? value
    : isRecord(value) && typeof value.text === "string"
      ? value.text
      : "";
}
function stringify(value: unknown): string {
  return value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}

function logSdkEvent(event: CursorSdkEvent, logger: HarnessLogger): void {
  const call = extractCursorToolCall(event);
  const type = [event.type, event.subtype]
    .filter((value) => typeof value === "string" && value)
    .join(".");
  const level = harnessEventLogLevel(type, {
    isError:
      (call?.subtype === "completed" && !call.ok) ||
      event.type === "error" ||
      event.status === "error",
    hasContent: call?.subtype === "completed",
  });
  if (level !== undefined)
    logger.log({ category: "cursor", level, message: sanitizeErrorMessage(JSON.stringify(event)) });
}
