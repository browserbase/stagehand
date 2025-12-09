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

const MAX_LINE_LENGTH = 160;

// Flow logging config dir - empty string disables logging entirely
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || "";

const NOISY_CDP_EVENTS = new Set([
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
]);

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

/** Calculate base64 data size in KB */
const dataToKb = (data: string): string =>
  ((data.length * 0.75) / 1024).toFixed(1);

/** Truncate CDP IDs: frameId:363F03EB...EF8 → frameId:363F…5EF8 */
function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_, pre: string, id: string) => `${pre}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

/** Truncate line showing start...end */
function truncateLine(value: string, maxLen: number): string {
  const collapsed = value.replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) return collapsed;
  const endLen = Math.floor(maxLen * 0.3);
  const startLen = maxLen - endLen - 1;
  return `${collapsed.slice(0, startLen)}…${collapsed.slice(-endLen)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (value == null || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function formatArgs(args?: unknown | unknown[]): string {
  if (args === undefined) return "";
  return (Array.isArray(args) ? args : [args])
    .filter((e) => e !== undefined)
    .map(formatValue)
    .filter((e) => e.length > 0)
    .join(", ");
}

const shortId = (id: string | null | undefined): string =>
  id ? id.slice(-4) : "-";

function formatTag(
  label: string | null | undefined,
  id: string | null | undefined,
  icon: string,
): string {
  return id ? `[${icon} #${shortId(id)}${label ? " " + label : ""}]` : "⤑";
}

let nonce = 0;
function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

const SENSITIVE_KEYS =
  /apikey|api_key|key|secret|token|password|passwd|pwd|credential|auth/i;

function sanitizeOptions(options: V3Options): Record<string, unknown> {
  const sanitize = (obj: unknown): unknown => {
    if (typeof obj !== "object" || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = SENSITIVE_KEYS.test(key) ? "******" : sanitize(value);
    }
    return result;
  };
  return sanitize({ ...options }) as Record<string, unknown>;
}

/** Remove unescaped quotes for cleaner log output */
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

  // Build context tags - always add parent span tags (formatTag returns ⤑ for null IDs)
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
  const argsStr = event.params ? formatArgs(event.params) : "";

  if (event.category === "AgentTask") {
    if (event.event === "started") {
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const m = event.metrics;
      const durationSec = m?.durationMs
        ? (m.durationMs / 1000).toFixed(1)
        : "?";
      const llmStats = `${m?.llmRequests ?? 0} LLM calls ꜛ${m?.inputTokens ?? 0} ꜜ${m?.outputTokens ?? 0} tokens`;
      const cdpStats = `${m?.cdpEvents ?? 0} CDP msgs`;
      details = `✓ Agent.execute() DONE in ${durationSec}s | ${llmStats} | ${cdpStats}`;
    }
  } else if (event.category === "StagehandStep") {
    if (event.event === "started") {
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const durationSec = event.metrics?.durationMs
        ? (event.metrics.durationMs / 1000).toFixed(2)
        : "?";
      details = `✓ ${event.stepLabel || "STEP"} completed in ${durationSec}s`;
    }
  } else if (event.category === "UnderstudyAction") {
    if (event.event === "started") {
      details = `▷ ${event.method}(${argsStr})`;
    } else if (event.event === "completed") {
      const durationSec = event.metrics?.durationMs
        ? (event.metrics.durationMs / 1000).toFixed(2)
        : "?";
      details = `✓ ${event.actionLabel || "ACTION"} completed in ${durationSec}s`;
    }
  } else if (event.category === "CDP") {
    const icon = event.event === "call" ? "⏵" : "⏴";
    details = `${icon} ${event.method}(${argsStr})`;
  } else if (event.category === "LLM") {
    if (event.event === "request") {
      const promptStr = event.prompt ? " " + String(event.prompt) : "";
      details = `${event.model} ⏴${promptStr}`;
    } else if (event.event === "response") {
      const hasTokens =
        event.inputTokens !== undefined || event.outputTokens !== undefined;
      const tokenStr = hasTokens
        ? ` ꜛ${event.inputTokens ?? 0} ꜜ${event.outputTokens ?? 0} |`
        : "";
      const outputStr = event.output ? " " + String(event.output) : "";
      details = `${event.model} ↳${tokenStr}${outputStr}`;
    }
  }

  if (!details) return null;

  // Assemble line and apply final truncation
  const fullLine = `${formatTimestamp()} ${parts.join(" ")} ${details}`;
  const cleaned = removeQuotes(fullLine);
  const processed =
    event.category === "CDP" ? truncateCdpIds(cleaned) : cleaned;
  return truncateLine(processed, MAX_LINE_LENGTH);
}

/** Check if a CDP event should be filtered from pretty output */
function shouldFilterCdpEvent(event: FlowEvent): boolean {
  if (event.category !== "CDP") return false;
  if (event.method?.endsWith(".enable") || event.method === "enable")
    return true;
  return event.event === "message" && NOISY_CDP_EVENTS.has(event.method!);
}

// =============================================================================
// Stream Creation
// =============================================================================

const isWritable = (s: fs.WriteStream | null): s is fs.WriteStream =>
  !!(s && !s.destroyed && s.writable);

function createJsonlStream(ctx: FlowLoggerContext): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _, cb) {
      if (ctx.initialized && isWritable(ctx.fileStreams.jsonl)) {
        ctx.fileStreams.jsonl.write(chunk, cb);
      } else cb();
    },
  });
}

function createPrettyStream(
  ctx: FlowLoggerContext,
  category: EventCategory,
  streamKey: keyof FlowLoggerContext["fileStreams"],
): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _, cb) {
      const stream = ctx.fileStreams[streamKey];
      if (!ctx.initialized || !isWritable(stream)) return cb();
      try {
        const event = JSON.parse(chunk) as FlowEvent;
        if (event.category !== category || shouldFilterCdpEvent(event))
          return cb();
        const line = prettifyEvent(event);
        if (line) stream.write(line + "\n", cb);
        else cb();
      } catch {
        cb();
      }
    },
  });
}

// =============================================================================
// Public Helpers (used by external callers)
// =============================================================================

/**
 * Get the config directory. Returns empty string if logging is disabled.
 */
export function getConfigDir(): string {
  return CONFIG_DIR ? path.resolve(CONFIG_DIR) : "";
}

// =============================================================================
// Prompt Preview Helpers
// =============================================================================

type ContentPart = {
  type?: string;
  text?: string;
  content?: unknown[];
  source?: { data?: string };
  image_url?: { url?: string };
  inlineData?: { data?: string };
};

/** Extract text and image info from a content array (handles nested tool_result) */
function extractFromContent(
  content: unknown[],
  result: { text?: string; extras: string[] },
): void {
  for (const part of content) {
    const p = part as ContentPart;
    // Text
    if (!result.text && p.text) {
      result.text = p.type === "text" || !p.type ? p.text : undefined;
    }
    // Images - various formats
    if (p.type === "image" || p.type === "image_url") {
      const url = p.image_url?.url;
      if (url?.startsWith("data:"))
        result.extras.push(`${dataToKb(url)}kb image`);
      else if (p.source?.data)
        result.extras.push(`${dataToKb(p.source.data)}kb image`);
      else result.extras.push("image");
    } else if (p.source?.data) {
      result.extras.push(`${dataToKb(p.source.data)}kb image`);
    } else if (p.inlineData?.data) {
      result.extras.push(`${dataToKb(p.inlineData.data)}kb image`);
    }
    // Recurse into tool_result content
    if (p.type === "tool_result" && Array.isArray(p.content)) {
      extractFromContent(p.content, result);
    }
  }
}

/** Build final preview string with extras */
function buildPreview(
  text: string | undefined,
  extras: string[],
  maxLen?: number,
): string | undefined {
  if (!text && extras.length === 0) return undefined;
  let result = text || "";
  if (maxLen && result.length > maxLen)
    result = result.slice(0, maxLen) + "...";
  if (extras.length > 0) {
    const extrasStr = extras.map((e) => `+{${e}}`).join(" ");
    result = result ? `${result} ${extrasStr}` : extrasStr;
  }
  return result || undefined;
}

/**
 * Format a prompt preview from LLM messages for logging.
 * Returns format like: "some text... +{5.8kb image} +{schema} +{12 tools}"
 */
export function formatLlmPromptPreview(
  messages: Array<{ role: string; content: unknown }>,
  options?: { toolCount?: number; hasSchema?: boolean },
): string | undefined {
  try {
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    if (!lastUserMsg) return undefined;

    const result = {
      text: undefined as string | undefined,
      extras: [] as string[],
    };

    if (typeof lastUserMsg.content === "string") {
      result.text = lastUserMsg.content;
    } else if (Array.isArray(lastUserMsg.content)) {
      extractFromContent(lastUserMsg.content, result);
    } else {
      return undefined;
    }

    // Clean instruction prefix
    if (result.text) {
      result.text = result.text.replace(/^[Ii]nstruction: /, "");
    }

    if (options?.hasSchema) result.extras.push("schema");
    if (options?.toolCount) result.extras.push(`${options.toolCount} tools`);

    return buildPreview(result.text, result.extras);
  } catch {
    return undefined;
  }
}

/**
 * Extract a text preview from CUA-style messages.
 * Accepts various message formats (Anthropic, OpenAI, Google).
 */
export function formatCuaPromptPreview(
  messages: unknown[],
  maxLen = 100,
): string | undefined {
  try {
    const lastMsg = messages
      .filter((m) => {
        const msg = m as { role?: string; type?: string };
        return msg.role === "user" || msg.type === "tool_result";
      })
      .pop() as
      | { content?: unknown; parts?: unknown[]; text?: string }
      | undefined;

    if (!lastMsg) return undefined;

    const result = {
      text: undefined as string | undefined,
      extras: [] as string[],
    };

    if (typeof lastMsg.content === "string") {
      result.text = lastMsg.content;
    } else if (typeof lastMsg.text === "string") {
      result.text = lastMsg.text;
    } else if (Array.isArray(lastMsg.parts)) {
      extractFromContent(lastMsg.parts, result);
    } else if (Array.isArray(lastMsg.content)) {
      extractFromContent(lastMsg.content, result);
    }

    return buildPreview(result.text, result.extras, maxLen);
  } catch {
    return undefined;
  }
}

/** Format CUA response output for logging */
export function formatCuaResponsePreview(
  output: unknown,
  maxLen = 100,
): string {
  try {
    // Handle Google format or array
    const items: unknown[] =
      (output as { candidates?: [{ content?: { parts?: unknown[] } }] })
        ?.candidates?.[0]?.content?.parts ??
      (Array.isArray(output) ? output : []);

    const preview = items
      .map((item) => {
        const i = item as {
          type?: string;
          text?: string;
          name?: string;
          functionCall?: { name?: string };
        };
        if (i.text) return i.text.slice(0, 50);
        if (i.functionCall?.name) return `fn:${i.functionCall.name}`;
        if (i.type === "tool_use" && i.name) return `tool_use:${i.name}`;
        return i.type ? `[${i.type}]` : "[item]";
      })
      .join(" ");

    return preview.slice(0, maxLen);
  } catch {
    return "[error]";
  }
}

// =============================================================================
// SessionFileLogger - Main API
// =============================================================================

export class SessionFileLogger {
  /**
   * Initialize a new logging context. Call this at the start of a session.
   * If BROWSERBASE_CONFIG_DIR is not set, logging is disabled.
   */
  static init(sessionId: string, v3Options?: V3Options): void {
    const configDir = getConfigDir();
    if (!configDir) return; // Logging disabled

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
      const dir = ctx.sessionDir;
      ctx.fileStreams.agent = fs.createWriteStream(
        path.join(dir, "agent_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.stagehand = fs.createWriteStream(
        path.join(dir, "stagehand_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.understudy = fs.createWriteStream(
        path.join(dir, "understudy_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.cdp = fs.createWriteStream(
        path.join(dir, "cdp_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.llm = fs.createWriteStream(
        path.join(dir, "llm_events.log"),
        { flags: "a" },
      );
      ctx.fileStreams.jsonl = fs.createWriteStream(
        path.join(dir, "session_events.jsonl"),
        { flags: "a" },
      );

      ctx.initialized = true;

      // Create pino multistream: JSONL + pretty streams per category
      const streams: pino.StreamEntry[] = [
        { stream: createJsonlStream(ctx) },
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
    SessionFileLogger.logAgentTaskCompleted();
    await Promise.all(
      Object.values(ctx.fileStreams)
        .filter(Boolean)
        .map((s) => new Promise<void>((r) => s!.end(r))),
    ).catch(() => {});
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

  private static logCdpEvent(
    eventType: "call" | "message",
    {
      method,
      params,
      targetId,
    }: { method: string; params?: unknown; targetId?: string | null },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;
    if (eventType === "call") ctx.metrics.cdpEvents++;
    ctx.logger.info({
      category: "CDP",
      event: eventType,
      method,
      params,
      targetId,
    } as FlowEvent);
  }

  static logCdpCallEvent(
    data: { method: string; params?: object; targetId?: string | null },
    ctx?: FlowLoggerContext | null,
  ): void {
    SessionFileLogger.logCdpEvent("call", data, ctx);
  }

  static logCdpMessageEvent(
    data: { method: string; params?: unknown; targetId?: string | null },
    ctx?: FlowLoggerContext | null,
  ): void {
    SessionFileLogger.logCdpEvent("message", data, ctx);
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
   * Returns a no-op middleware when logging is disabled.
   */
  static createLlmLoggingMiddleware(
    modelId: string,
  ): Pick<LanguageModelMiddleware, "wrapGenerate"> {
    // No-op middleware when logging is disabled
    if (!CONFIG_DIR) {
      return {
        wrapGenerate: async ({ doGenerate }) => doGenerate(),
      };
    }

    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        const ctx = SessionFileLogger.getContext();
        // Skip logging overhead if no context (shouldn't happen but be safe)
        if (!ctx) {
          return doGenerate();
        }
        const llmRequestId = uuidv7();
        const toolCount = Array.isArray(params.tools) ? params.tools.length : 0;

        // Extract prompt preview from last non-system message
        const messages = (params.prompt ?? []) as Array<{
          role?: string;
          content?: unknown;
        }>;
        const lastMsg = messages.filter((m) => m.role !== "system").pop();
        const extracted = {
          text: undefined as string | undefined,
          extras: [] as string[],
        };

        let rolePrefix = lastMsg?.role ?? "?";
        if (lastMsg) {
          if (typeof lastMsg.content === "string") {
            extracted.text = lastMsg.content;
          } else if (Array.isArray(lastMsg.content)) {
            // Check for tool-result first
            const toolResult = (
              lastMsg.content as Array<{
                type?: string;
                toolName?: string;
                output?: { type?: string; value?: unknown };
              }>
            ).find((p) => p.type === "tool-result");
            if (toolResult) {
              rolePrefix = `tool result: ${toolResult.toolName}()`;
              const out = toolResult.output;
              if (out?.type === "json" && out.value) {
                extracted.text = JSON.stringify(out.value).slice(0, 150);
              } else if (Array.isArray(out?.value)) {
                extractFromContent(out.value as unknown[], extracted);
              }
            } else {
              extractFromContent(lastMsg.content as unknown[], extracted);
            }
          }
        }

        const promptText = extracted.text || "(no text)";
        const promptPreview = `${rolePrefix}: ${promptText} +{${toolCount} tools}`;

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

        // Extract output preview
        const res = result as {
          text?: string;
          content?: unknown;
          toolCalls?: unknown[];
        };
        let outputPreview = res.text || "";
        if (!outputPreview && res.content) {
          if (typeof res.content === "string") {
            outputPreview = res.content;
          } else if (Array.isArray(res.content)) {
            outputPreview = (
              res.content as Array<{
                type?: string;
                text?: string;
                toolName?: string;
              }>
            )
              .map(
                (c) =>
                  c.text ||
                  (c.type === "tool-call"
                    ? `tool call: ${c.toolName}()`
                    : `[${c.type}]`),
              )
              .join(" ");
          }
        }
        if (!outputPreview && res.toolCalls?.length) {
          outputPreview = `[${res.toolCalls.length} tool calls]`;
        }

        SessionFileLogger.logLlmResponse(
          {
            requestId: llmRequestId,
            model: modelId,
            operation: "generateText",
            output: outputPreview || "[empty]",
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

/**
 * Method decorator for logging understudy actions with automatic start/complete.
 * Logs all arguments automatically. No-op when CONFIG_DIR is empty.
 */
export function logAction(actionType: string) {
  return function <T extends (...args: never[]) => Promise<unknown>>(
    originalMethod: T,
  ): T {
    // No-op when logging is disabled
    if (!CONFIG_DIR) {
      return originalMethod;
    }

    return async function (this: unknown, ...args: unknown[]) {
      SessionFileLogger.logUnderstudyActionEvent({
        actionType,
        args: args.length > 0 ? args : undefined,
      });

      try {
        return await originalMethod.apply(this, args as never[]);
      } finally {
        SessionFileLogger.logUnderstudyActionCompleted();
      }
    } as T;
  };
}

/**
 * Method decorator for logging Stagehand step events (act, extract, observe).
 * Only adds logging - does NOT wrap with withInstanceLogContext (caller handles that).
 * No-op when CONFIG_DIR is empty.
 */
export function logStagehandStep(invocation: string, label: string) {
  return function <T extends (...args: never[]) => Promise<unknown>>(
    originalMethod: T,
  ): T {
    // No-op when logging is disabled
    if (!CONFIG_DIR) {
      return originalMethod;
    }

    return async function (
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      SessionFileLogger.logStagehandStepEvent({
        invocation,
        args: args.length > 0 ? args : undefined,
        label,
      });

      try {
        return await originalMethod.apply(this, args as never[]);
      } finally {
        SessionFileLogger.logStagehandStepCompleted();
      }
    } as T;
  };
}
