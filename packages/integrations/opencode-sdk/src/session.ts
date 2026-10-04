import { fork, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type OpenCodePart = Record<string, unknown>;
export interface OpenCodeMessage {
  type: "assistant";
  content: OpenCodePart[];
  cost?: number;
  tokens?: Record<string, unknown>;
  error?: { message?: string };
}
export interface OpenCodeTokenUsage {
  /** False when the SDK exposed no token object, so zeros are unknown rather than free. */
  reported?: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}
export interface OpenCodeSessionResult {
  messages: OpenCodeMessage[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: OpenCodeTokenUsage;
  costUsd?: number;
  iterationError?: unknown;
}
export interface OpenCodePermission {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}
export interface OpenCodeLocalServer {
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  codemode: false;
  disabled?: boolean;
}
export interface OpenCodeConfig {
  share?: "disabled";
  update?: "disable";
  model?: string;
  agents?: Record<string, { system: string }>;
  mcp: { servers: Record<string, OpenCodeLocalServer> };
  permissions: OpenCodePermission[];
}
export interface OpenCodeSessionConfig {
  config: OpenCodeConfig;
  directory: string;
  configRoot: string;
}
export interface OpenCodeRuntime {
  run(input: {
    prompt: string;
    model: string;
    signal?: AbortSignal;
    maxToolSteps?: number;
  }): Promise<OpenCodeSessionResult>;
  close(): Promise<void>;
}
export type StartOpenCodeRuntime = (options: {
  session: OpenCodeSessionConfig;
  onToolResult?: (toolName: string, part: OpenCodePart) => void | Promise<void>;
}) => Promise<OpenCodeRuntime>;

/** Prefixed onto `agents.build.system` so eval policy uses OpenCode's native channel. */
export function withOpenCodeSystemPrompt(
  session: OpenCodeSessionConfig,
  systemPrompt?: string,
): OpenCodeSessionConfig {
  if (!systemPrompt) return session;
  const existing = session.config.agents?.build?.system;
  return {
    ...session,
    config: {
      ...session.config,
      agents: {
        ...session.config.agents,
        build: { system: existing ? `${systemPrompt}\n\n${existing}` : systemPrompt },
      },
    },
  };
}

export function normalizeOpenCodeModel(
  model: string,
): { providerID: string; id: string } | undefined {
  if (model === "opencode/auto" || model === "auto") return undefined;
  const separator = model.indexOf("/");
  if (separator < 1 || separator === model.length - 1) {
    throw new HarnessAdapterError(
      `OpenCode model "${sanitizeErrorMessage(model)}" must use provider/model format.`,
    );
  }
  return { providerID: model.slice(0, separator), id: model.slice(separator + 1) };
}

export function extractOpenCodeAssistantText(message: unknown): string {
  const content = readRecord(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map(readRecord)
    .filter((part): part is Record<string, unknown> => part?.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export function buildOpenCodeTranscript(messages: OpenCodeMessage[]): string {
  return messages
    .flatMap((message) =>
      message.content.map((part) => {
        if (part.type === "reasoning" && typeof part.text === "string")
          return `[reasoning] ${part.text}`;
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "tool")
          return `[tool ${String(part.name ?? "unknown")}] ${safeStringify(part.state)}`;
        return "";
      }),
    )
    .filter(Boolean)
    .join("\n");
}

export function normalizeOpenCodeUsage(tokens: unknown): OpenCodeTokenUsage {
  const value = readRecord(tokens);
  const cache = readRecord(value?.cache);
  const inputTokens = finite(value?.input);
  const outputTokens = finite(value?.output);
  const reasoningOutputTokens = finite(value?.reasoning);
  return {
    reported: value !== undefined,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cachedInputTokens: finite(cache?.read),
    cacheCreationInputTokens: finite(cache?.write),
    totalTokens: inputTokens + outputTokens + reasoningOutputTokens,
  };
}

export async function runOpenCodeSession(input: {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  signal?: AbortSignal;
  session: OpenCodeSessionConfig;
  systemPrompt?: string;
  maxToolSteps?: number;
  startRuntime?: StartOpenCodeRuntime;
  onToolResult?: (toolName: string, part: OpenCodePart) => void | Promise<void>;
}): Promise<OpenCodeSessionResult> {
  let runtime: OpenCodeRuntime | undefined;
  try {
    runtime = await (input.startRuntime ?? startOpenCodeRuntime)({
      session: withOpenCodeSystemPrompt(input.session, input.systemPrompt),
      onToolResult: input.onToolResult,
    });
    return await runtime.run({
      prompt: input.prompt,
      model: input.model,
      signal: input.signal,
      ...(input.maxToolSteps !== undefined && { maxToolSteps: input.maxToolSteps }),
    });
  } catch (error) {
    const stopReason = sanitizeErrorMessage(
      stringifyError(input.signal?.aborted ? input.signal.reason : error),
    );
    input.logger.warn({
      category: "opencode",
      message: `OpenCode stopped before a normal result: ${stopReason}`,
      level: 0,
    });
    return {
      messages: [],
      finalMessage: "",
      status: "sdk_error",
      stopReason,
      tokenUsage: normalizeOpenCodeUsage(undefined),
      iterationError: error,
    };
  } finally {
    await runtime?.close();
  }
}

export async function startOpenCodeRuntime(options: {
  session: OpenCodeSessionConfig;
  onToolResult?: (toolName: string, part: OpenCodePart) => void | Promise<void>;
}): Promise<OpenCodeRuntime> {
  await Promise.all([
    mkdir(options.session.directory, { recursive: true }),
    mkdir(options.session.configRoot, { recursive: true }),
  ]);
  const child = fork(new URL("./worker.mjs", import.meta.url), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: [],
  });
  let settled = false;
  let resolveRun: ((result: OpenCodeSessionResult) => void) | undefined;
  let rejectRun: ((error: Error) => void) | undefined;
  child.on("message", (raw: unknown) => {
    const message = readRecord(raw);
    if (!message) return;
    if (message.kind === "tool") {
      Promise.resolve(
        options.onToolResult?.(String(message.name), readRecord(message.part) ?? {}),
      ).then(
        () => child.send({ kind: "tool-ack", id: message.id }),
        (error) => child.send({ kind: "tool-ack", id: message.id, error: stringifyError(error) }),
      );
      return;
    }
    if (message.kind === "result") {
      settled = true;
      resolveRun?.(message.result as unknown as OpenCodeSessionResult);
    }
    if (message.kind === "error") {
      settled = true;
      rejectRun?.(new Error(sanitizeErrorMessage(String(message.message))));
    }
  });
  child.on("exit", (code, signal) => {
    if (!settled) rejectRun?.(new Error(`OpenCode worker exited (${signal ?? code}).`));
  });
  return {
    run: ({ prompt, model, signal, maxToolSteps }) => {
      const onAbort = () => child.send({ kind: "abort" });
      return new Promise<OpenCodeSessionResult>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        child.send({
          kind: "run",
          prompt,
          model,
          session: options.session,
          ...(maxToolSteps !== undefined && { maxToolSteps }),
        });
      }).finally(() => {
        signal?.removeEventListener("abort", onAbort);
      });
    },
    close: async () => closeWorker(child),
  };
}

async function closeWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (child.connected) child.send({ kind: "close" });
  else child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeStringify(value);
}
