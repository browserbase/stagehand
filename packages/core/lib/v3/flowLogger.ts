import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { Writable } from "node:stream";
import { v7 as uuidv7 } from "uuid";
import path from "node:path";
import pino from "pino";
import type { LanguageModelMiddleware } from "ai";
import type { V3Options } from "./types/public";

// =============================================================================
// Constants
// =============================================================================

const MAX_ARG_LENGTH = 500;
const MAX_LINE_LENGTH = 140;
const MAX_LLM_LINE_LENGTH = 500;

// CDP events to filter from pretty output (still logged to JSONL)
const NOISY_CDP_EVENTS = [
  "Target.targetInfoChanged",
  "Runtime.executionContextCreated",
  "Runtime.executionContextDestroyed",
  "Runtime.executionContextsCleared",
  "Page.lifecycleEvent",
  "Network.dataReceived",
  "Network.loadingFinished",
  "Network.requestWillBeSentExtraInfo",
  "Network.responseReceivedExtraInfo",
  "Network.requestWillBeSent",
  "Network.responseReceived",
];

// =============================================================================
// Types
// =============================================================================

type EventCategory =
  | "AgentTask"
  | "StagehandStep"
  | "UnderstudyAction"
  | "CDP"
  | "LLM";

interface FlowEvent {
  // Core identifiers (set via mixin from child logger bindings)
  eventId: string;
  sessionId: string;
  taskId?: string | null;
  stepId?: string | null;
  stepLabel?: string | null;
  actionId?: string | null;
  actionLabel?: string | null;

  // Event classification
  category: EventCategory;
  event: "started" | "completed" | "call" | "message" | "request" | "response";
  method?: string;
  msg?: string;

  // Event-specific payload (not truncated)
  params?: unknown;
  targetId?: string | null;

  // LLM event fields (for individual LLM request/response events only)
  requestId?: string; // Correlation ID linking LLM request to response
  model?: string;
  prompt?: unknown;
  output?: unknown;
  inputTokens?: number; // Tokens for THIS specific LLM call
  outputTokens?: number; // Tokens for THIS specific LLM call

  // Aggregate metrics (for completion events only - task/step/action)
  metrics?: {
    durationMs?: number;
    llmRequests?: number; // Total LLM calls in this span
    inputTokens?: number; // Total input tokens across all LLM calls
    outputTokens?: number; // Total output tokens across all LLM calls
    cdpEvents?: number; // Total CDP events in this span
  };
}

interface FlowLoggerMetrics {
  taskStartTime?: number;
  stepStartTime?: number;
  actionStartTime?: number;
  llmRequests: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  cdpEvents: number;
}

export interface FlowLoggerContext {
  logger: pino.Logger;
  metrics: FlowLoggerMetrics;
  sessionId: string;
  sessionDir: string;
  configDir: string;
  initPromise: Promise<void>;
  initialized: boolean;
  // Current span context (mutable, injected via mixin)
  taskId: string | null;
  stepId: string | null;
  stepLabel: string | null;
  actionId: string | null;
  actionLabel: string | null;
  // File handles for pretty streams
  fileStreams: {
    agent: fs.WriteStream | null;
    stagehand: fs.WriteStream | null;
    understudy: fs.WriteStream | null;
    cdp: fs.WriteStream | null;
    llm: fs.WriteStream | null;
    jsonl: fs.WriteStream | null;
  };
}

const loggerContext = new AsyncLocalStorage<FlowLoggerContext>();

// =============================================================================
// Formatting Utilities (used by pretty streams)
// =============================================================================

function truncate(value: string, maxLen = MAX_ARG_LENGTH): string {
  value = value.replace(/\s+/g, " ");
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen)}…`;
}

/**
 * Truncate CDP IDs (32-char uppercase hex strings) that appear after id/Id patterns.
 * Transforms: frameId:363F03EB7E3795ACB434672C35095EF8 → frameId:363F…5EF8
 */
function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_match, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

/**
 * Truncate conversation/prompt strings showing first 30 chars + ... + last 100 chars
 */
function truncateConversation(value: string): string {
  value = value.replace(/\s+/g, " ");
  const maxLen = 130;
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, 30)}…${value.slice(-100)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `'${value}'`;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return "[unserializable array]";
    }
  }
  if (typeof value === "object" && value !== null) {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return "[unserializable object]";
    }
  }
  if (value === undefined) {
    return "undefined";
  }
  return truncate(String(value));
}

function formatArgs(args?: unknown | unknown[]): string {
  if (args === undefined) {
    return "";
  }
  const normalized = (Array.isArray(args) ? args : [args]).filter(
    (entry) => entry !== undefined,
  );
  const rendered = normalized
    .map((entry) => formatValue(entry))
    .filter((entry) => entry.length > 0);
  return rendered.join(", ");
}

function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  return id.slice(-4);
}

function formatTag(
  label: string | null | undefined,
  id: string | null | undefined,
  icon: string,
): string {
  if (!id) return `⤑`;
  return `[${icon} #${shortId(id)}${label ? " " : ""}${label || ""}]`;
}

let nonce = 0;

function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
  const monotonic = String(nonce++ % 100).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}${monotonic}`;
}

function sanitizeOptions(options: V3Options): Record<string, unknown> {
  const sensitiveKeys = [
    "apiKey",
    "api_key",
    "apikey",
    "key",
    "secret",
    "token",
    "password",
    "passwd",
    "pwd",
    "credential",
    "credentials",
    "auth",
    "authorization",
  ];

  const sanitizeValue = (obj: unknown): unknown => {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeValue);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        result[key] = "******";
      } else if (typeof value === "object" && value !== null) {
        result[key] = sanitizeValue(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  return sanitizeValue({ ...options }) as Record<string, unknown>;
}

/**
 * Remove unescaped quotes from a string for cleaner log output
 */
function removeQuotes(str: string): string {
  return str
    .replace(/([^\\])["']/g, "$1")
    .replace(/^["']|["']$/g, "")
    .trim();
}

// =============================================================================
// Pretty Formatting (converts FlowEvent to human-readable log line)
// =============================================================================

function prettifyEvent(event: FlowEvent): string | null {
  const parts: string[] = [];

  // Build context tags based on category
  if (event.category === "AgentTask") {
    parts.push(formatTag("", event.taskId, "🅰"));
  } else if (event.category === "StagehandStep") {
    parts.push(formatTag("", event.taskId, "🅰"));
    parts.push(formatTag(event.stepLabel, event.stepId, "🆂"));
  } else if (event.category === "UnderstudyAction") {
    parts.push(formatTag("", event.taskId, "🅰"));
    parts.push(formatTag(event.stepLabel, event.stepId, "🆂"));
    parts.push(formatTag(event.actionLabel, event.actionId, "🆄"));
  } else if (event.category === "CDP") {
    parts.push(formatTag("", event.taskId, "🅰"));
    parts.push(formatTag(event.stepLabel, event.stepId, "🆂"));
    parts.push(formatTag(event.actionLabel, event.actionId, "🆄"));
    parts.push(formatTag("CDP", event.targetId, "🅲"));
  } else if (event.category === "LLM") {
    parts.push(formatTag("", event.taskId, "🅰"));
    parts.push(formatTag(event.stepLabel, event.stepId, "🆂"));
    parts.push(formatTag("LLM", event.requestId, "🧠"));
  }

  // Build details based on event type
  let details = "";

  if (event.category === "AgentTask") {
    if (event.event === "started") {
      const argsStr = event.params ? formatArgs(event.params) : "";
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const m = event.metrics;
      const durationSec = m?.durationMs
        ? (m.durationMs / 1000).toFixed(1)
        : "?";
      const llmStats = m
        ? `${m.llmRequests} LLM calls ꜛ${m.inputTokens} ꜜ${m.outputTokens} tokens`
        : "";
      const cdpStats = m ? `${m.cdpEvents} CDP msgs` : "";
      details = `✓ Agent.execute() DONE in ${durationSec}s | ${llmStats} | ${cdpStats}`;
    }
  } else if (event.category === "StagehandStep") {
    if (event.event === "started") {
      const argsStr = event.params ? formatArgs(event.params) : "";
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const durationSec = event.metrics?.durationMs
        ? (event.metrics.durationMs / 1000).toFixed(2)
        : "?";
      details = `✓ ${event.stepLabel || "STEP"} completed in ${durationSec}s`;
    }
  } else if (event.category === "UnderstudyAction") {
    if (event.event === "started") {
      const argsStr = event.params ? formatArgs(event.params) : "";
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const durationSec = event.metrics?.durationMs
        ? (event.metrics.durationMs / 1000).toFixed(2)
        : "?";
      details = `✓ ${event.actionLabel || "ACTION"} completed in ${durationSec}s`;
    }
  } else if (event.category === "CDP") {
    const argsStr = event.params ? formatArgs(event.params) : "";
    const call = argsStr ? `${event.method}(${argsStr})` : `${event.method}()`;
    if (event.event === "call") {
      details = `⏵ ${call}`;
    } else if (event.event === "message") {
      details = `⏴ ${call}`;
    }
  } else if (event.category === "LLM") {
    if (event.event === "request") {
      const promptStr = event.prompt
        ? ` ${truncateConversation(String(event.prompt))}`
        : "";
      details = `${event.model} ⏴${promptStr}`;
    } else if (event.event === "response") {
      const tokens =
        event.inputTokens !== undefined || event.outputTokens !== undefined
          ? ` ꜛ${event.inputTokens ?? 0} ꜜ${event.outputTokens ?? 0} |`
          : "";
      const outputStr = event.output
        ? ` ${truncateConversation(String(event.output))}`
        : "";
      details = `${event.model} ↳${tokens}${outputStr}`;
    }
  }

  if (!details) return null;

  const fullLine = `${formatTimestamp()} ${parts.join(" ")} ${details}`;
  const withoutQuotes = removeQuotes(fullLine);

  // Apply category-specific truncation
  if (event.category === "CDP") {
    const truncatedIds = truncateCdpIds(withoutQuotes);
    return truncatedIds.length > MAX_LINE_LENGTH
      ? `${truncatedIds.slice(0, MAX_LINE_LENGTH - 1)}…`
      : truncatedIds;
  } else if (event.category === "LLM") {
    return withoutQuotes.length > MAX_LLM_LINE_LENGTH
      ? `${withoutQuotes.slice(0, MAX_LLM_LINE_LENGTH - 1)}…`
      : withoutQuotes;
  }

  return withoutQuotes;
}

/**
 * Check if a CDP event should be filtered from pretty output
 */
function shouldFilterCdpEvent(event: FlowEvent): boolean {
  if (event.category !== "CDP") return false;

  // Filter .enable calls
  if (event.method?.endsWith(".enable") || event.method === "enable") {
    return true;
  }

  // Filter noisy message events
  if (event.event === "message" && NOISY_CDP_EVENTS.includes(event.method!)) {
    return true;
  }

  return false;
}

// =============================================================================
// Stream Creation (inline in this file)
// =============================================================================

/**
 * Create a JSONL stream that writes full events verbatim
 */
function createJsonlStream(ctx: FlowLoggerContext): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _encoding, callback) {
      const stream = ctx.fileStreams.jsonl;
      if (!ctx.initialized || !stream || stream.destroyed || !stream.writable) {
        callback();
        return;
      }
      // Pino already adds a newline, so just write the chunk as-is
      stream.write(chunk, callback);
    },
  });
}

/**
 * Create a pretty stream for a specific category
 */
function createPrettyStream(
  ctx: FlowLoggerContext,
  category: EventCategory,
  streamKey: keyof FlowLoggerContext["fileStreams"],
): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _encoding, callback) {
      const stream = ctx.fileStreams[streamKey];
      if (!ctx.initialized || !stream || stream.destroyed || !stream.writable) {
        callback();
        return;
      }

      try {
        const event = JSON.parse(chunk) as FlowEvent;

        // Category routing
        if (event.category !== category) {
          callback();
          return;
        }

        // Filter noisy CDP events from pretty output
        if (shouldFilterCdpEvent(event)) {
          callback();
          return;
        }

        // Pretty format the event
        const line = prettifyEvent(event);
        if (!line) {
          callback();
          return;
        }

        stream.write(line + "\n", callback);
      } catch {
        callback();
      }
    },
  });
}

// =============================================================================
// Public Helpers (used by external callers)
// =============================================================================

/**
 * Get the config directory from environment or use default
 */
export function getConfigDir(): string {
  const fromEnv = process.env.BROWSERBASE_CONFIG_DIR;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd(), ".browserbase");
}

/**
 * Format a prompt preview from LLM messages for logging.
 */
export function formatLlmPromptPreview(
  messages: Array<{ role: string; content: unknown }>,
  options?: { toolCount?: number; hasSchema?: boolean },
): string | undefined {
  const lastUserMsg = messages.filter((m) => m.role === "user").pop();
  if (!lastUserMsg) return undefined;

  let preview: string;
  if (typeof lastUserMsg.content === "string") {
    preview = lastUserMsg.content
      .replace("instruction: ", "")
      .replace("Instruction: ", "");
  } else if (Array.isArray(lastUserMsg.content)) {
    preview = lastUserMsg.content
      .map((c: unknown) => {
        const item = c as { text?: string };
        return item.text ? item.text : "[img]";
      })
      .join(" ");
  } else {
    return undefined;
  }

  const suffixes: string[] = [];
  if (options?.hasSchema) {
    suffixes.push("schema");
  }
  if (options?.toolCount && options.toolCount > 0) {
    suffixes.push(`${options.toolCount} tools`);
  }

  if (suffixes.length > 0) {
    return `${preview} +{${suffixes.join(", ")}}`;
  }
  return preview;
}

/**
 * Extract a text preview from CUA-style messages.
 * Accepts various message formats (Anthropic, OpenAI, Google).
 */
export function formatCuaPromptPreview(
  messages: unknown[],
  maxLen = 100,
): string | undefined {
  // Find last user message - handle various formats
  const lastUserMsg = messages
    .filter((m) => {
      const msg = m as { role?: string };
      return msg.role === "user";
    })
    .pop() as
    | { role?: string; content?: unknown; parts?: unknown[] }
    | undefined;

  if (!lastUserMsg) return undefined;

  let text: string | undefined;

  if (typeof lastUserMsg.content === "string") {
    text = lastUserMsg.content;
  } else if (Array.isArray(lastUserMsg.parts)) {
    const firstPart = lastUserMsg.parts[0] as { text?: string } | undefined;
    text = firstPart?.text;
  } else if (Array.isArray(lastUserMsg.content)) {
    text = "[multipart message]";
  }

  if (!text) return undefined;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * Format CUA response output for logging.
 */
export function formatCuaResponsePreview(
  output: unknown,
  maxLen = 100,
): string {
  const googleParts = (
    output as {
      candidates?: Array<{
        content?: { parts?: unknown[] };
      }>;
    }
  )?.candidates?.[0]?.content?.parts;

  const items: unknown[] = googleParts ?? (Array.isArray(output) ? output : []);

  const preview = items
    .map((item) => {
      const i = item as {
        type?: string;
        text?: string;
        name?: string;
        functionCall?: { name?: string };
      };
      if (i.text) return i.text.slice(0, 50);
      if (i.type === "text" && typeof i.text === "string")
        return i.text.slice(0, 50);
      if (i.functionCall?.name) return `fn:${i.functionCall.name}`;
      if (i.type === "tool_use" && i.name) return `tool_use:${i.name}`;
      if (i.type) return `[${i.type}]`;
      return "[item]";
    })
    .join(" ");

  return preview.length > maxLen ? preview.slice(0, maxLen) : preview;
}

// =============================================================================
// SessionFileLogger - Main API
// =============================================================================

export class SessionFileLogger {
  /**
   * Initialize a new logging context. Call this at the start of a session.
   */
  static init(sessionId: string, v3Options?: V3Options): void {
    const configDir = getConfigDir();
    const sessionDir = path.join(configDir, "sessions", sessionId);

    // Create context with placeholder logger (will be replaced after streams init)
    const ctx: FlowLoggerContext = {
      logger: pino({ level: "silent" }), // Placeholder, replaced below
      metrics: {
        llmRequests: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        cdpEvents: 0,
      },
      sessionId,
      sessionDir,
      configDir,
      initPromise: Promise.resolve(),
      initialized: false,
      // Span context - mutable, injected into every log via mixin
      taskId: null,
      stepId: null,
      stepLabel: null,
      actionId: null,
      actionLabel: null,
      fileStreams: {
        agent: null,
        stagehand: null,
        understudy: null,
        cdp: null,
        llm: null,
        jsonl: null,
      },
    };

    // Store init promise for awaiting in log methods
    ctx.initPromise = SessionFileLogger.initAsync(ctx, v3Options);

    loggerContext.enterWith(ctx);
  }

  private static async initAsync(
    ctx: FlowLoggerContext,
    v3Options?: V3Options,
  ): Promise<void> {
    try {
      await fs.promises.mkdir(ctx.sessionDir, { recursive: true });

      if (v3Options) {
        const sanitizedOptions = sanitizeOptions(v3Options);
        const sessionJsonPath = path.join(ctx.sessionDir, "session.json");
        await fs.promises.writeFile(
          sessionJsonPath,
          JSON.stringify(sanitizedOptions, null, 2),
          "utf-8",
        );
      }

      // Create symlink to latest session
      const latestLink = path.join(ctx.configDir, "sessions", "latest");
      try {
        try {
          await fs.promises.unlink(latestLink);
        } catch {
          // Ignore if doesn't exist
        }
        await fs.promises.symlink(ctx.sessionId, latestLink, "dir");
      } catch {
        // Symlink creation can fail on Windows or due to permissions
      }

      // Create file streams
      ctx.fileStreams.agent = fs.createWriteStream(
        path.join(ctx.sessionDir, "agent_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.stagehand = fs.createWriteStream(
        path.join(ctx.sessionDir, "stagehand_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.understudy = fs.createWriteStream(
        path.join(ctx.sessionDir, "understudy_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.cdp = fs.createWriteStream(
        path.join(ctx.sessionDir, "cdp_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.llm = fs.createWriteStream(
        path.join(ctx.sessionDir, "llm_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.jsonl = fs.createWriteStream(
        path.join(ctx.sessionDir, "session_events.jsonl"),
        { flags: "a" },
      );

      ctx.initialized = true;

      // Create pino logger with multistream
      const streams: pino.StreamEntry[] = [
        // JSONL stream - full events
        { stream: createJsonlStream(ctx) },
        // Pretty streams per category
        { stream: createPrettyStream(ctx, "AgentTask", "agent") },
        { stream: createPrettyStream(ctx, "StagehandStep", "stagehand") },
        { stream: createPrettyStream(ctx, "UnderstudyAction", "understudy") },
        { stream: createPrettyStream(ctx, "CDP", "cdp") },
        { stream: createPrettyStream(ctx, "LLM", "llm") },
      ];

      // Create logger with mixin that injects span context from AsyncLocalStorage
      ctx.logger = pino(
        {
          level: "info",
          // Mixin adds eventId and current span context to every log
          mixin() {
            const store = loggerContext.getStore();
            return {
              eventId: uuidv7(),
              sessionId: store?.sessionId,
              taskId: store?.taskId,
              stepId: store?.stepId,
              stepLabel: store?.stepLabel,
              actionId: store?.actionId,
              actionLabel: store?.actionLabel,
            };
          },
        },
        pino.multistream(streams),
      );
    } catch {
      // Fail silently
    }
  }

  static async close(): Promise<void> {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    await ctx.initPromise;

    // Log task completion if there's an active task
    SessionFileLogger.logAgentTaskCompleted();

    const closePromises: Promise<void>[] = [];

    for (const stream of Object.values(ctx.fileStreams)) {
      if (stream) {
        closePromises.push(
          new Promise((resolve) => {
            stream.end(() => resolve());
          }),
        );
      }
    }

    try {
      await Promise.all(closePromises);
    } catch {
      // Fail silently
    }
  }

  static get sessionId(): string | null {
    return loggerContext.getStore()?.sessionId ?? null;
  }

  static get sessionDir(): string | null {
    return loggerContext.getStore()?.sessionDir ?? null;
  }

  /**
   * Get the current logger context object.
   */
  static getContext(): FlowLoggerContext | null {
    return loggerContext.getStore() ?? null;
  }

  // ===========================================================================
  // Agent Task Events
  // ===========================================================================

  /**
   * Start a new task and log it.
   */
  static logAgentTaskStarted({
    invocation,
    args,
  }: {
    invocation: string;
    args?: unknown | unknown[];
  }): void {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    // Set up task context
    ctx.taskId = uuidv7();
    ctx.stepId = null;
    ctx.stepLabel = null;
    ctx.actionId = null;
    ctx.actionLabel = null;

    // Reset metrics for new task
    ctx.metrics = {
      taskStartTime: Date.now(),
      llmRequests: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      cdpEvents: 0,
    };

    ctx.logger.info({
      category: "AgentTask",
      event: "started",
      method: invocation,
      params: args,
    } as FlowEvent);
  }

  /**
   * Log task completion with metrics summary.
   */
  static logAgentTaskCompleted(options?: { cacheHit?: boolean }): void {
    const ctx = loggerContext.getStore();
    if (!ctx || !ctx.metrics.taskStartTime) return;

    const durationMs = Date.now() - ctx.metrics.taskStartTime;

    const event: Partial<FlowEvent> = {
      category: "AgentTask",
      event: "completed",
      method: "Agent.execute",
      metrics: {
        durationMs,
        llmRequests: ctx.metrics.llmRequests,
        inputTokens: ctx.metrics.llmInputTokens,
        outputTokens: ctx.metrics.llmOutputTokens,
        cdpEvents: ctx.metrics.cdpEvents,
      },
    };

    if (options?.cacheHit) {
      event.msg = "CACHE HIT, NO LLM NEEDED";
    }

    ctx.logger.info(event);

    // Clear task context
    ctx.taskId = null;
    ctx.stepId = null;
    ctx.stepLabel = null;
    ctx.actionId = null;
    ctx.actionLabel = null;
    ctx.metrics.taskStartTime = undefined;
  }

  // ===========================================================================
  // Stagehand Step Events
  // ===========================================================================

  static logStagehandStepEvent({
    invocation,
    args,
    label,
  }: {
    invocation: string;
    args?: unknown | unknown[];
    label: string;
  }): string {
    const ctx = loggerContext.getStore();
    if (!ctx) return uuidv7();

    // Set up step context
    ctx.stepId = uuidv7();
    ctx.stepLabel = label.toUpperCase();
    ctx.actionId = null;
    ctx.actionLabel = null;
    ctx.metrics.stepStartTime = Date.now();

    ctx.logger.info({
      category: "StagehandStep",
      event: "started",
      method: invocation,
      params: args,
    } as FlowEvent);

    return ctx.stepId;
  }

  static logStagehandStepCompleted(): void {
    const ctx = loggerContext.getStore();
    if (!ctx || !ctx.stepId) return;

    const durationMs = ctx.metrics.stepStartTime
      ? Date.now() - ctx.metrics.stepStartTime
      : 0;

    ctx.logger.info({
      category: "StagehandStep",
      event: "completed",
      metrics: { durationMs },
    } as FlowEvent);

    // Clear step context
    ctx.stepId = null;
    ctx.stepLabel = null;
    ctx.actionId = null;
    ctx.actionLabel = null;
    ctx.metrics.stepStartTime = undefined;
  }

  // ===========================================================================
  // Understudy Action Events
  // ===========================================================================

  static logUnderstudyActionEvent({
    actionType,
    target,
    args,
  }: {
    actionType: string;
    target?: string;
    args?: unknown | unknown[];
  }): string {
    const ctx = loggerContext.getStore();
    if (!ctx) return uuidv7();

    // Set up action context
    ctx.actionId = uuidv7();
    ctx.actionLabel = actionType
      .toUpperCase()
      .replace("UNDERSTUDY.", "")
      .replace("PAGE.", "");
    ctx.metrics.actionStartTime = Date.now();

    const params: Record<string, unknown> = {};
    if (target) params.target = target;
    if (args) params.args = args;

    ctx.logger.info({
      category: "UnderstudyAction",
      event: "started",
      method: actionType,
      params: Object.keys(params).length > 0 ? params : undefined,
    } as FlowEvent);

    return ctx.actionId;
  }

  static logUnderstudyActionCompleted(): void {
    const ctx = loggerContext.getStore();
    if (!ctx || !ctx.actionId) return;

    const durationMs = ctx.metrics.actionStartTime
      ? Date.now() - ctx.metrics.actionStartTime
      : 0;

    ctx.logger.info({
      category: "UnderstudyAction",
      event: "completed",
      metrics: { durationMs },
    } as FlowEvent);

    // Clear action context
    ctx.actionId = null;
    ctx.actionLabel = null;
    ctx.metrics.actionStartTime = undefined;
  }

  // ===========================================================================
  // CDP Events
  // ===========================================================================

  static logCdpCallEvent(
    {
      method,
      params,
      targetId,
    }: {
      method: string;
      params?: object;
      targetId?: string | null;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Track CDP events for task metrics
    ctx.metrics.cdpEvents++;

    // Log full event - filtering happens in pretty stream
    ctx.logger.info({
      category: "CDP",
      event: "call",
      method,
      params,
      targetId,
    } as FlowEvent);
  }

  static logCdpMessageEvent(
    {
      method,
      params,
      targetId,
    }: {
      method: string;
      params?: unknown;
      targetId?: string | null;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Log full event - filtering happens in pretty stream
    ctx.logger.info({
      category: "CDP",
      event: "message",
      method,
      params,
      targetId,
    } as FlowEvent);
  }

  // ===========================================================================
  // LLM Events
  // ===========================================================================

  static logLlmRequest(
    {
      requestId,
      model,
      prompt,
    }: {
      requestId: string;
      model: string;
      operation: string;
      prompt?: string;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Track LLM requests for task metrics
    ctx.metrics.llmRequests++;

    ctx.logger.info({
      category: "LLM",
      event: "request",
      requestId,
      method: "LLM.request",
      model,
      prompt,
    });
  }

  static logLlmResponse(
    {
      requestId,
      model,
      output,
      inputTokens,
      outputTokens,
    }: {
      requestId: string;
      model: string;
      operation: string;
      output?: string;
      inputTokens?: number;
      outputTokens?: number;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Track tokens for task metrics
    ctx.metrics.llmInputTokens += inputTokens ?? 0;
    ctx.metrics.llmOutputTokens += outputTokens ?? 0;

    ctx.logger.info({
      category: "LLM",
      event: "response",
      requestId,
      method: "LLM.response",
      model,
      output,
      inputTokens,
      outputTokens,
    });
  }

  // ===========================================================================
  // LLM Logging Middleware
  // ===========================================================================

  /**
   * Create middleware for wrapping language models with LLM call logging.
   * Returns a partial middleware object compatible with AI SDK's wrapLanguageModel.
   */
  static createLlmLoggingMiddleware(
    modelId: string,
  ): Pick<LanguageModelMiddleware, "wrapGenerate"> {
    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        // Capture context at the start of the call
        const ctx = SessionFileLogger.getContext();

        const llmRequestId = uuidv7();

        const p = params;

        const toolCount = Array.isArray(p.tools) ? p.tools.length : 0;

        // Find the last non-system message
        const nonSystemMessages = (p.prompt ?? []).filter((m: unknown) => {
          const msg = m as { role?: string };
          return msg.role !== "system";
        });
        const lastMsg = nonSystemMessages[nonSystemMessages.length - 1] as
          | Record<string, unknown>
          | undefined;
        const lastRole = (lastMsg?.role as string) ?? "?";

        let lastContent = "";
        let toolName = "";

        if (lastMsg) {
          if (lastMsg.content && Array.isArray(lastMsg.content)) {
            for (const part of lastMsg.content) {
              const item = part as Record<string, unknown>;
              if (item.type === "tool-result") {
                toolName = (item.toolName as string) || "";
                const output = item.output as
                  | Record<string, unknown>
                  | undefined;

                if (output) {
                  if (output.type === "json" && output.value) {
                    lastContent = JSON.stringify(output.value).slice(0, 150);
                  } else if (Array.isArray(output.value)) {
                    const parts: string[] = [];
                    for (const v of output.value) {
                      const vItem = v as Record<string, unknown>;
                      if (vItem.type === "text" && vItem.text) {
                        parts.push(vItem.text as string);
                      } else if (
                        vItem.mediaType &&
                        typeof vItem.data === "string"
                      ) {
                        const sizeKb = (
                          ((vItem.data as string).length * 0.75) /
                          1024
                        ).toFixed(1);
                        parts.push(`[${sizeKb}kb img]`);
                      }
                    }
                    if (parts.length > 0) {
                      lastContent = parts.join(" ");
                    }
                  }
                }
                break;
              } else if (item.type === "text") {
                lastContent += (item.text as string) || "";
              }
            }
          } else if (typeof lastMsg.content === "string") {
            lastContent = lastMsg.content;
          }
        }

        if (!lastContent && lastMsg) {
          try {
            const debugStr = JSON.stringify(lastMsg, (key, value) => {
              if (typeof value === "string" && value.length > 100) {
                if (value.startsWith("data:image")) {
                  const sizeKb = ((value.length * 0.75) / 1024).toFixed(1);
                  return `[${sizeKb}kb image]`;
                }
                return value.slice(0, 50) + "...";
              }
              return value;
            });
            lastContent = debugStr.slice(0, 300);
          } catch {
            lastContent = "(unserializable)";
          }
        }

        const rolePrefix = toolName ? `tool result: ${toolName}()` : lastRole;
        const contentTruncated = lastContent
          ? truncateConversation(lastContent)
          : "(no text)";
        const promptPreview = `${rolePrefix}: ${contentTruncated} +{${toolCount} tools}`;

        SessionFileLogger.logLlmRequest(
          {
            requestId: llmRequestId,
            model: modelId,
            operation: "generateText",
            prompt: promptPreview,
          },
          ctx,
        );

        const result = await doGenerate();

        let outputPreview = "";
        const res = result as {
          text?: string;
          content?: unknown;
          toolCalls?: unknown[];
        };
        if (res.text) {
          outputPreview = res.text;
        } else if (res.content) {
          if (typeof res.content === "string") {
            outputPreview = res.content;
          } else if (Array.isArray(res.content)) {
            outputPreview = res.content
              .map((c: unknown) => {
                const item = c as {
                  type?: string;
                  text?: string;
                  toolName?: string;
                };
                if (item.type === "text") return item.text;
                if (item.type === "tool-call")
                  return `tool call: ${item.toolName}()`;
                return `[${item.type || "unknown"}]`;
              })
              .join(" ");
          } else {
            outputPreview = String(res.content);
          }
        } else if (res.toolCalls?.length) {
          outputPreview = `[${res.toolCalls.length} tool calls]`;
        } else if (typeof result === "object" && result !== null) {
          const keys = Object.keys(result).filter(
            (k) => k !== "usage" && k !== "rawResponse",
          );
          outputPreview =
            keys.length > 0 ? `{${keys.join(", ")}}` : "[empty response]";
        }

        SessionFileLogger.logLlmResponse(
          {
            requestId: llmRequestId,
            model: modelId,
            operation: "generateText",
            output: outputPreview,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
          },
          ctx,
        );

        return result;
      },
    };
  }
}
