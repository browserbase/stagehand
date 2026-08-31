import { randomUUID } from "node:crypto";
import {
  HarnessAdapterError,
  harnessEventLogLevel,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type MastraEvent = Record<string, unknown>;

export type MastraStdioServerDefinition = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  onToolError?: "throw" | "return";
};

export type MastraAgentLike = {
  stream: (
    prompt: string,
    options?: Record<string, unknown>,
  ) => Promise<{
    fullStream: AsyncIterable<MastraEvent>;
    text?: Promise<string>;
    error?: unknown;
  }>;
};

export type MastraMcpClientLike = {
  listToolsWithErrors: () => Promise<{
    tools: Record<string, unknown>;
    errors: Record<string, string>;
  }>;
  disconnect: () => Promise<void>;
};

export type MastraSdk = {
  createAgent: (config: Record<string, unknown>) => MastraAgentLike;
  createMcpClient: (options: {
    id?: string;
    servers: Record<string, MastraStdioServerDefinition>;
    timeout?: number;
  }) => MastraMcpClientLike;
  createTool: (options: {
    id: string;
    description: string;
    inputSchema: unknown;
    execute: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
  }) => unknown;
};

export type MastraSessionConfig = {
  instructions?: string;
  maxSteps?: number;
  mcpServers?: Record<string, MastraStdioServerDefinition>;
  tools?: Record<string, unknown>;
  agentId?: string;
  agentName?: string;
  modelSettings?: Record<string, unknown>;
  /** AI SDK provider options forwarded to every model call (e.g. OpenAI reasoning summaries). */
  providerOptions?: Record<string, Record<string, unknown>>;
  mcpTimeoutMs?: number;
  disconnectTimeoutMs?: number;
};

export type MastraTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
};

export type MastraSessionResult = {
  events: MastraEvent[];
  finalText: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  finishReason?: string;
  stepCount: number;
  tokenUsage: MastraTokenUsage;
  iterationError?: unknown;
};

export const MASTRA_CORE_PACKAGE = "@mastra/core";
export const MASTRA_MCP_PACKAGE = "@mastra/mcp";

export async function loadMastraSdk(): Promise<MastraSdk> {
  try {
    const agentSpecifier = `${MASTRA_CORE_PACKAGE}/agent`;
    const toolsSpecifier = `${MASTRA_CORE_PACKAGE}/tools`;
    const mcpSpecifier = MASTRA_MCP_PACKAGE;
    const agentModule = (await import(agentSpecifier)) as Record<string, unknown>;
    const toolsModule = (await import(toolsSpecifier)) as Record<string, unknown>;
    const mcpModule = (await import(mcpSpecifier)) as Record<string, unknown>;
    if (typeof agentModule.Agent !== "function") throw new Error("Agent export missing");
    if (typeof toolsModule.createTool !== "function") throw new Error("createTool export missing");
    if (typeof mcpModule.MCPClient !== "function") throw new Error("MCPClient export missing");

    const AgentConstructor = agentModule.Agent as new (
      config: Record<string, unknown>,
    ) => MastraAgentLike;
    const McpClientConstructor = mcpModule.MCPClient as new (options: {
      id?: string;
      servers: Record<string, MastraStdioServerDefinition>;
      timeout?: number;
    }) => MastraMcpClientLike;
    const createTool = toolsModule.createTool as MastraSdk["createTool"];
    return {
      createAgent: (config) => new AgentConstructor(config),
      createMcpClient: (options) => new McpClientConstructor(options),
      createTool,
    };
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Mastra harness requires ${MASTRA_CORE_PACKAGE} and ${MASTRA_MCP_PACKAGE}. Install them in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
}

export function normalizeMastraModel(model: string): string {
  if (model === "mastra/default") return "openai/gpt-5.4-mini";
  return model.includes("/") ? model : `openai/${model}`;
}

export async function runMastraSession(input: {
  prompt: string;
  model: string;
  sdk?: MastraSdk;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: MastraSessionConfig;
  onToolResult?: (toolName: string) => void | Promise<void>;
}): Promise<MastraSessionResult> {
  const sdk = input.sdk ?? (await loadMastraSdk());
  const events: MastraEvent[] = [];
  const maxSteps = positiveInteger(input.session.maxSteps, 50);
  const disconnectTimeoutMs = positiveInteger(input.session.disconnectTimeoutMs, 30_000);
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) controller.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  let client: MastraMcpClientLike | undefined;
  let finalText = "";
  let textBuffer = "";
  let stopReason: string | undefined;
  let finishReason: string | undefined;
  let iterationError: unknown;
  let stepCount = 0;
  let tokenUsage = extractMastraTokenUsage(undefined);
  let summedStepUsage = extractMastraTokenUsage(undefined);

  try {
    let mcpTools: Record<string, unknown> = {};
    if (input.session.mcpServers && Object.keys(input.session.mcpServers).length > 0) {
      const servers = Object.fromEntries(
        Object.entries(input.session.mcpServers).map(([name, server]) => [
          name,
          { ...server, onToolError: server.onToolError ?? "return" },
        ]),
      );
      client = sdk.createMcpClient({
        id: `stagehand-evals-mastra-${randomUUID()}`,
        servers,
        ...(positiveIntegerOrUndefined(input.session.mcpTimeoutMs) && {
          timeout: positiveIntegerOrUndefined(input.session.mcpTimeoutMs),
        }),
      });
      let discovery: { tools: Record<string, unknown>; errors: Record<string, string> } | undefined;
      try {
        discovery = await raceAbort(client.listToolsWithErrors(), controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        stopReason = sanitizeErrorMessage(stringifyError(controller.signal.reason) || "aborted");
      }
      if (discovery && Object.keys(discovery.errors).length > 0) {
        const failedServers = Object.keys(discovery.errors);
        stopReason = `MCP server discovery failed for: ${failedServers.join(", ")}`;
        for (const [server, error] of Object.entries(discovery.errors)) {
          input.logger.warn({
            category: "mastra",
            message: `MCP server discovery error for ${server}: ${sanitizeErrorMessage(error)}`,
            level: 1,
          });
        }
      } else if (discovery) {
        mcpTools = discovery.tools;
      }
    }

    if (!stopReason) {
      const agent = sdk.createAgent({
        id: input.session.agentId ?? "stagehand-evals-mastra",
        name: input.session.agentName ?? "Stagehand Evals Mastra Agent",
        instructions:
          input.session.instructions ?? "Use the available browser/web tools to complete the task.",
        model: normalizeMastraModel(input.model),
        tools: { ...mcpTools, ...input.session.tools },
      });
      const stream = await agent.stream(input.prompt, {
        maxSteps,
        abortSignal: controller.signal,
        ...(input.session.modelSettings && { modelSettings: input.session.modelSettings }),
        ...(input.session.providerOptions && { providerOptions: input.session.providerOptions }),
      });

      for await (const event of stream.fullStream) {
        events.push(compactMastraEvent(event));
        logMastraEvent(input.logger, event);
        const payload = isRecord(event.payload) ? event.payload : {};
        if (event.type === "tool-call") {
          textBuffer = "";
        } else if (event.type === "text-delta" && typeof payload.text === "string") {
          textBuffer += payload.text;
        } else if (event.type === "tool-result" || event.type === "tool-error") {
          if (typeof payload.toolName === "string") {
            await input.onToolResult?.(payload.toolName);
          }
        } else if (event.type === "step-finish") {
          stepCount += 1;
          const output = isRecord(payload.output) ? payload.output : undefined;
          if (isRecord(output?.usage)) {
            summedStepUsage = addTokenUsage(summedStepUsage, extractMastraTokenUsage(output.usage));
          }
        } else if (event.type === "finish") {
          const stepResult = isRecord(payload.stepResult) ? payload.stepResult : undefined;
          finishReason = typeof stepResult?.reason === "string" ? stepResult.reason : finishReason;
          const output = isRecord(payload.output) ? payload.output : undefined;
          if (isRecord(output?.usage)) tokenUsage = extractMastraTokenUsage(output.usage);
        } else if (event.type === "error") {
          stopReason = sanitizeErrorMessage(stringifyError(payload.error) || "error");
        } else if (event.type === "abort") {
          stopReason = sanitizeErrorMessage(stringifyError(input.signal?.reason) || "aborted");
        }
      }
      finalText = textBuffer;
      if (!finalText && stream.text) {
        try {
          finalText = await stream.text;
        } catch {
          // The stream's explicit error is reported below when available.
        }
      }
      if (stream.error && !stopReason) {
        stopReason = sanitizeErrorMessage(stringifyError(stream.error));
      }
      if (isEmptyTokenUsage(tokenUsage)) tokenUsage = summedStepUsage;
    }
  } catch (error) {
    iterationError = error;
    input.logger.warn({
      category: "mastra",
      message: `Mastra stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: {
        error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" },
      },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    if (client) {
      try {
        await withTimeout(
          client.disconnect(),
          disconnectTimeoutMs,
          `Mastra MCP disconnect timed out after ${disconnectTimeoutMs}ms`,
        );
      } catch (error) {
        const detail = sanitizeErrorMessage(stringifyError(error));
        input.logger.warn({
          category: "mastra",
          message: detail.startsWith("Mastra MCP disconnect timed out")
            ? detail
            : `Mastra MCP disconnect failed: ${detail}`,
          level: 1,
        });
      }
    }
  }

  const status = resolveMastraStatus({
    iterationError,
    stopReason,
    finishReason,
    stepCount,
    maxSteps,
  });
  if (status === "max_turns") stopReason ??= `step budget exhausted (${maxSteps} steps)`;
  return {
    events,
    finalText,
    status,
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    ...(finishReason && { finishReason }),
    stepCount,
    tokenUsage,
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function resolveMastraStatus(args: {
  iterationError: unknown;
  stopReason?: string;
  finishReason?: string;
  stepCount: number;
  maxSteps: number;
}): "completed" | "max_turns" | "sdk_error" {
  if (args.iterationError || args.stopReason) return "sdk_error";
  if (
    args.finishReason === "tool-calls" ||
    (args.stepCount >= args.maxSteps && args.finishReason !== "stop")
  ) {
    return "max_turns";
  }
  return "completed";
}

export function extractMastraTokenUsage(
  usage: Record<string, unknown> | undefined,
): MastraTokenUsage {
  const inputTokens = toFiniteNumber(usage?.inputTokens);
  const outputTokens = toFiniteNumber(usage?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: toFiniteNumber(usage?.reasoningTokens),
    cachedInputTokens: toFiniteNumber(usage?.cachedInputTokens),
    totalTokens: toFiniteNumber(usage?.totalTokens) || inputTokens + outputTokens,
  };
}

export function buildMastraTranscript(events: MastraEvent[]): string {
  return events
    .filter((event) =>
      ["tool-call", "tool-result", "tool-error", "text-delta", "error"].includes(
        String(event.type ?? ""),
      ),
    )
    .map((event) => summarizeMastraEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logMastraEvent(logger: HarnessLogger, event: MastraEvent): void {
  const type = String(event.type ?? "unknown");
  const level = harnessEventLogLevel(type, {
    isError: type === "error" || type === "tool-error",
    hasContent: type === "tool-call" || type === "tool-result",
  });
  if (level === undefined) return;
  const summary = summarizeMastraEvent(event);
  logger.log({
    category: "mastra",
    message: summary.message,
    level,
    auxiliary: {
      type: { value: type, type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeMastraEvent(event: MastraEvent): {
  message: string;
  detail?: string;
} {
  const type = String(event.type ?? "unknown");
  const payload = isRecord(event.payload) ? event.payload : {};
  const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool";
  if (type === "tool-call") {
    const args = safeJson(payload.args) ?? "{}";
    return sanitizeMastraSummary(`tool: ${toolName} ${clip(args, 500)}`, args);
  }
  if (type === "tool-result") {
    const text = flattenMcpResult(payload.result);
    return sanitizeMastraSummary(`tool result: ${toolName} ${clip(text, 500)}`, text);
  }
  if (type === "tool-error") {
    const message = stringifyError(payload.error) || "tool error";
    return sanitizeMastraSummary(`tool error: ${toolName} ${clip(message, 500)}`, message);
  }
  if (type === "text-delta" && typeof payload.text === "string") {
    return sanitizeMastraSummary(`assistant: ${clip(payload.text, 500)}`, payload.text);
  }
  if (type === "reasoning-delta" && typeof payload.text === "string") {
    return sanitizeMastraSummary(`reasoning: ${clip(payload.text, 500)}`, payload.text);
  }
  if (type === "finish" || type === "step-finish") {
    const stepResult = isRecord(payload.stepResult) ? payload.stepResult : undefined;
    const reason = String(stepResult?.reason ?? "unknown");
    const output = isRecord(payload.output) ? payload.output : undefined;
    return sanitizeMastraSummary(`${type}: ${reason}`, safeJson(output?.usage));
  }
  if (type === "error") {
    const message = stringifyError(payload.error) || "error";
    return sanitizeMastraSummary(`error: ${clip(message, 500)}`, message);
  }
  const detail = safeJson(compactMastraEvent(event));
  return sanitizeMastraSummary(
    `${type} event`,
    detail === undefined ? undefined : clip(detail, MAX_EVENT_DETAIL_CHARS),
  );
}

const MAX_EVENT_DETAIL_CHARS = 2_000;

/** Chunk types the trajectory adapter and transcript read verbatim. */
const RETAINED_MASTRA_EVENT_TYPES = new Set([
  "tool-call",
  "tool-result",
  "tool-error",
  "text-delta",
  "reasoning-delta",
  "error",
  "abort",
]);

/**
 * Reduce a fullStream chunk to what the session consumers need. Mastra's
 * `step-finish`/`finish` payloads carry the whole request body (every prior
 * message and tool result) under `metadata.request`/`response`, so retaining or
 * stringifying them per step grows quadratically with the conversation.
 */
export function compactMastraEvent(event: MastraEvent): MastraEvent {
  const type = String(event.type ?? "");
  if (RETAINED_MASTRA_EVENT_TYPES.has(type)) return event;
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const output = isRecord(payload?.output) ? payload.output : undefined;
  const compactPayload: Record<string, unknown> = {
    ...(payload?.stepResult !== undefined && { stepResult: payload.stepResult }),
    ...(payload?.reason !== undefined && { reason: payload.reason }),
    ...(payload?.toolName !== undefined && { toolName: payload.toolName }),
    ...(payload?.toolCallId !== undefined && { toolCallId: payload.toolCallId }),
    ...(output?.usage !== undefined && { output: { usage: output.usage } }),
  };
  return {
    type: event.type,
    ...(event.runId !== undefined && { runId: event.runId }),
    ...(event.from !== undefined && { from: event.from }),
    ...(payload !== undefined && { payload: compactPayload }),
  };
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
  if (isRecord(value) && typeof value.message === "string") return value.message;
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

function positiveInteger(value: unknown, fallback: number): number {
  return positiveIntegerOrUndefined(value) ?? fallback;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : undefined;
}

function sanitizeMastraSummary(
  message: string,
  detail?: string,
): { message: string; detail?: string } {
  return {
    message: sanitizeErrorMessage(message),
    ...(detail !== undefined && { detail: sanitizeErrorMessage(detail) }),
  };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  void promise.catch((): undefined => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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

function flattenMcpResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && Array.isArray(value.content)) {
    return value.content
      .map((block) => {
        if (!isRecord(block)) return "";
        if (block.type === "text" && typeof block.text === "string") return block.text;
        if (block.type === "image") return "[image]";
        return typeof block.text === "string" ? block.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return safeJson(value) ?? String(value ?? "");
}

function addTokenUsage(left: MastraTokenUsage, right: MastraTokenUsage): MastraTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function isEmptyTokenUsage(usage: MastraTokenUsage): boolean {
  return Object.values(usage).every((value) => value === 0);
}
