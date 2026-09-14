import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import type {
  AgentToolResult,
  CreateAgentSessionOptions,
  ResourceLoader,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { connectPiMcpServers } from "./mcp.js";

export type PiEvent = Record<string, unknown>;
export type PiToolDefinition = ToolDefinition<any, any, any>;
export type PiMcpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};
export type PiAgentSessionLike = {
  subscribe(listener: (event: PiEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  agent: {
    shouldStopAfterTurn?: (...args: any[]) => boolean | Promise<boolean>;
    state: { errorMessage?: string };
  };
};
export type PiSdk = {
  createSession(options: {
    model: string;
    cwd?: string;
    systemPrompt?: string;
    thinkingLevel?: string;
    customTools: PiToolDefinition[];
  }): Promise<PiAgentSessionLike>;
};
export type PiSessionConfig = {
  cwd?: string;
  systemPrompt?: string;
  thinkingLevel?: string;
  maxTurns?: number;
  customTools?: PiToolDefinition[];
  mcpServers?: Record<string, PiMcpServerSpec>;
};
export type PiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUsd: number;
};
export type PiSessionResult = {
  events: PiEvent[];
  finalMessage: string;
  turns: number;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: PiTokenUsage;
  iterationError?: unknown;
};

export const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";

export async function loadPiSdk(options: { logger?: HarnessLogger } = {}): Promise<PiSdk> {
  let pi: typeof import("@earendil-works/pi-coding-agent");
  try {
    const specifier = PI_SDK_PACKAGE;
    pi = await import(specifier);
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `pi SDK harness requires ${PI_SDK_PACKAGE}. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }

  return {
    async createSession(sessionOptions) {
      try {
        const cwd = sessionOptions.cwd ?? process.cwd();
        const modelRuntime = await pi.ModelRuntime.create();
        const resolved = pi.resolveCliModel({
          cliModel: normalizePiModel(sessionOptions.model),
          modelRuntime,
        });
        if (resolved.warning) {
          options.logger?.log({ category: "pi", message: resolved.warning, level: 1 });
        }
        if (resolved.error || !resolved.model) {
          throw new HarnessAdapterError(
            sanitizeErrorMessage(
              resolved.error ?? `Could not resolve pi model "${sessionOptions.model}".`,
            ),
          );
        }
        const settingsManager = pi.SettingsManager.inMemory({
          compaction: { enabled: false },
        });
        const resourceLoader: ResourceLoader = {
          getExtensions: () => ({
            extensions: [],
            errors: [],
            runtime: pi.createExtensionRuntime(),
          }),
          getSkills: () => ({ skills: [], diagnostics: [] }),
          getPrompts: () => ({ prompts: [], diagnostics: [] }),
          getThemes: () => ({ themes: [], diagnostics: [] }),
          getAgentsFiles: () => ({ agentsFiles: [] }),
          getSystemPrompt: () =>
            sessionOptions.systemPrompt ?? "You are a browser automation agent under evaluation.",
          getSystemPromptSource: () => undefined,
          getAppendSystemPrompt: () => [],
          getAppendSystemPromptSources: () => [],
          extendResources: () => {},
          reload: async () => {},
        };
        const { session } = await pi.createAgentSession({
          cwd,
          modelRuntime,
          model: resolved.model,
          thinkingLevel: (sessionOptions.thinkingLevel ??
            resolved.thinkingLevel ??
            "off") as CreateAgentSessionOptions["thinkingLevel"],
          resourceLoader,
          sessionManager: pi.SessionManager.inMemory(cwd),
          settingsManager,
          customTools: sessionOptions.customTools,
          tools: sessionOptions.customTools.map((tool) => tool.name),
        });
        return session as unknown as PiAgentSessionLike;
      } catch (error) {
        if (error instanceof HarnessAdapterError) throw error;
        throw new HarnessAdapterError(
          `Failed to initialize the pi SDK: ${sanitizeErrorMessage(stringifyError(error))}`,
          { cause: error },
        );
      }
    },
  };
}

export function normalizePiModel(model: string): string {
  return model === "pi/default" ? "openai/gpt-5.4-mini" : model;
}

export async function runPiSession(input: {
  prompt: string;
  model: string;
  sdk?: PiSdk;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: PiSessionConfig;
  onToolResult?: (toolName: string) => void | Promise<void>;
}): Promise<PiSessionResult> {
  const sdk = input.sdk ?? (await loadPiSdk({ logger: input.logger }));
  const events: PiEvent[] = [];
  let iterationError: unknown;
  let stopReason: string | undefined;
  let piSession: PiAgentSessionLike | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let turns = 0;
  let notifications = Promise.resolve();
  const maxTurns = positiveInteger(input.session.maxTurns, 50);
  let mcp: Awaited<ReturnType<typeof connectPiMcpServers>> | undefined;
  const forwardAbort = (): void => {
    if (piSession) void piSession.abort();
  };

  try {
    if (Object.keys(input.session.mcpServers ?? {}).length > 0) {
      mcp = await connectPiMcpServers(input.session.mcpServers!, {
        logger: input.logger,
        signal: input.signal,
      });
    }
    const customTools = [...(input.session.customTools ?? []), ...(mcp?.tools ?? [])];
    piSession = await sdk.createSession({
      model: input.model,
      ...(input.session.cwd && { cwd: input.session.cwd }),
      ...(input.session.systemPrompt && { systemPrompt: input.session.systemPrompt }),
      ...(input.session.thinkingLevel && { thinkingLevel: input.session.thinkingLevel }),
      customTools,
    });
    piSession.agent.shouldStopAfterTurn = () => turns >= maxTurns;
    unsubscribe = piSession.subscribe((event) => {
      if (event.type === "message_update") return;
      events.push(event);
      logPiEvent(input.logger, event);
      if (event.type === "turn_end") turns += 1;
      if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
        notifications = notifications.then(() => input.onToolResult?.(event.toolName as string));
      }
    });
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (input.signal?.aborted) {
      // pi's abort() before a prompt is a no-op; skip the prompt entirely so a
      // cancelled row never starts an LLM session.
      await piSession.abort();
    } else {
      await piSession.prompt(input.prompt);
    }
    await notifications;

    const lastAssistant = findLastAssistantMessage(events);
    if (input.signal?.aborted) {
      stopReason = sanitizeErrorMessage(stringifyError(input.signal.reason) || "aborted");
    } else if (lastAssistant?.stopReason === "error") {
      stopReason = sanitizeErrorMessage(
        (typeof lastAssistant.errorMessage === "string" && lastAssistant.errorMessage) ||
          piSession.agent.state.errorMessage ||
          "pi reported an error",
      );
    } else if (lastAssistant?.stopReason === "aborted") {
      stopReason = sanitizeErrorMessage(
        (typeof lastAssistant.errorMessage === "string" && lastAssistant.errorMessage) ||
          piSession.agent.state.errorMessage ||
          "pi aborted the run",
      );
    } else if (lastAssistant?.stopReason === "length") {
      stopReason = "pi stopped: provider output length limit reached";
    } else if (turns >= maxTurns && lastAssistant?.stopReason === "toolUse") {
      stopReason = `turn budget exhausted (${maxTurns} turns)`;
    }
  } catch (error) {
    iterationError = error;
    stopReason = input.signal?.aborted
      ? sanitizeErrorMessage(stringifyError(input.signal.reason) || "aborted")
      : sanitizeErrorMessage(stringifyError(error));
    input.logger.warn({
      category: "pi",
      message: `pi stopped before a normal result: ${stopReason}`,
      level: 0,
      auxiliary: { error: { value: stopReason, type: "string" } },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    unsubscribe?.();
    if (piSession && !disposed) {
      disposed = true;
      piSession.dispose();
    }
    await mcp?.close();
  }

  const lastAssistant = findLastAssistantMessage(events);
  const budgetExhausted =
    turns >= maxTurns && lastAssistant?.stopReason === "toolUse" && !iterationError;
  return {
    events,
    finalMessage: assistantText(lastAssistant),
    turns,
    status: resolvePiStatus({ iterationError, stopReason, budgetExhausted }),
    ...(stopReason && { stopReason }),
    tokenUsage: extractPiTokenUsage(events),
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function extractPiTokenUsage(events: PiEvent[]): PiTokenUsage {
  const total: PiTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
  let sawReasoning = false;
  let reasoningTokens = 0;
  for (const event of events) {
    if (event.type !== "message_end" || !isRecord(event.message)) continue;
    const message = event.message;
    if (message.role !== "assistant" || !isRecord(message.usage)) continue;
    const usage = message.usage;
    total.inputTokens += toFiniteNumber(usage.input);
    total.outputTokens += toFiniteNumber(usage.output);
    total.cacheReadTokens += toFiniteNumber(usage.cacheRead);
    total.cacheWriteTokens += toFiniteNumber(usage.cacheWrite);
    total.totalTokens += toFiniteNumber(usage.totalTokens);
    if (usage.reasoning !== undefined) {
      sawReasoning = true;
      reasoningTokens += toFiniteNumber(usage.reasoning);
    }
    if (isRecord(usage.cost)) total.costUsd += toFiniteNumber(usage.cost.total);
  }
  return { ...total, ...(sawReasoning && { reasoningTokens }) };
}

export function buildPiTranscript(events: PiEvent[]): string {
  return events
    .map((event) => summarizePiEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logPiEvent(logger: HarnessLogger, event: PiEvent): void {
  const summary = summarizePiEvent(event);
  logger.log({
    category: "pi",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizePiEvent(event: PiEvent): { message: string; detail?: string } {
  const type = String(event.type ?? "unknown");
  if (type === "message_end" && isRecord(event.message)) {
    const text = assistantText(event.message);
    const detail = text || safeJson(event.message);
    return {
      message: sanitizeErrorMessage(`assistant: ${clip(text, 500)}`),
      ...(detail && { detail: sanitizeErrorMessage(detail) }),
    };
  }
  if (type.startsWith("tool_execution_")) {
    const detail = safeJson(event);
    return {
      message: sanitizeErrorMessage(`${type}: ${String(event.toolName ?? "tool")}`),
      ...(detail && { detail: sanitizeErrorMessage(detail) }),
    };
  }
  const detail = safeJson(event);
  return {
    message: sanitizeErrorMessage(`${type} event`),
    ...(detail && { detail: sanitizeErrorMessage(detail) }),
  };
}

export function resolvePiStatus(input: {
  iterationError?: unknown;
  stopReason?: string;
  budgetExhausted: boolean;
}): PiSessionResult["status"] {
  if (input.iterationError) return "sdk_error";
  if (input.budgetExhausted) return "max_turns";
  if (input.stopReason) return "sdk_error";
  return "completed";
}

export function definePiCodeRunTool(spec: {
  name: string;
  label?: string;
  description: string;
  codeParamDescription: string;
  execute: (code: string, signal?: AbortSignal) => Promise<string>;
}): PiToolDefinition {
  const parameters = Type.Object({
    code: Type.String({ description: spec.codeParamDescription }),
  });
  return {
    name: spec.name,
    label: spec.label ?? spec.name,
    description: spec.description,
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
      const text = await spec.execute((params as { code: string }).code, signal);
      return { content: [{ type: "text", text }], details: {} };
    },
  } as PiToolDefinition;
}

function findLastAssistantMessage(events: PiEvent[]): Record<string, unknown> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === "message_end" &&
      isRecord(event.message) &&
      event.message.role === "assistant"
    ) {
      return event.message;
    }
  }
  return undefined;
}

function assistantText(message: Record<string, unknown> | undefined): string {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
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
