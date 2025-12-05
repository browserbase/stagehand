import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { v7 as uuidv7 } from "uuid";
import path from "node:path";
import type { V3Options } from "./types/public";

const MAX_ARG_LENGTH = 500;

// TODO: Eventually refactor this to use pino logging system + eventbus listeners
// library code should emit an event to the bus instead of calling log funcs directly,
// logger watchdog should listen to the bus and forward the events to pino / OTEL
// events should track their parent events automatically (maybe with AsyncLocalStorage or manual child_events / parent_id fields),
// so span context can be reconstructed by following the parent chain, e.g. CDPEvent.parent_id -> StagehandStepEvent.parent_id -> AgentTaskEvent.parent_id -> etc.
// we should wait for the Stagehand.eventBus to be ready before working on this refactor

interface LogFile {
  path: string;
  stream: fs.WriteStream | null;
}

export interface FlowLoggerContext {
  sessionId: string;
  sessionDir: string;
  configDir: string;
  logFiles: {
    agent: LogFile;
    stagehand: LogFile;
    understudy: LogFile;
    cdp: LogFile;
    llm: LogFile;
  };
  initPromise: Promise<void>;
  initialized: boolean;
  // Flow context state for each tracing span (session -> task -> step -> action -> cdp,llm)
  agentTaskId: string | null;
  stagehandStepId: string | null;
  understudyActionId: string | null;
  stagehandStepLabel: string | null;
  understudyActionLabel: string | null;
  stagehandStepStartTime: number | null;
  understudyActionStartTime: number | null;
  // Task metrics
  agentTaskStartTime: number | null;
  agentTaskLlmRequests: number;
  agentTaskCdpEvents: number;
  agentTaskLlmInputTokens: number;
  agentTaskLlmOutputTokens: number;
}

const loggerContext = new AsyncLocalStorage<FlowLoggerContext>();

function truncate(value: string): string {
  value = value.replace(/\s+/g, " "); // replace newlines, tabs, etc. with space
  value = value.replace(/\s+/g, " "); // replace repeated spaces with single space
  if (value.length <= MAX_ARG_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ARG_LENGTH)}…`;
}

/**
 * Truncate CDP IDs (32-char uppercase hex strings) that appear after id/Id patterns.
 * Transforms: frameId:363F03EB7E3795ACB434672C35095EF8 → frameId:363F…5EF8
 */
function truncateCdpIds(value: string): string {
  // Match patterns like: id:, Id:, frameId:, loaderId:, etc. followed by optional quote and 32-char hex ID
  // The ID must be exactly 32 uppercase hex characters [0-9A-F]
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_match, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

/**
 * Truncate conversation/prompt strings showing first 30 chars + ... + last 100 chars
 * This helps see both the beginning context and the most recent part of growing conversations
 */
function truncateConversation(value: string): string {
  value = value.replace(/\s+/g, " "); // normalize whitespace
  const maxLen = 130; // 30 + 100
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

function formatTag(
  label: string,
  id: string | null,
  icon: string | null,
): string {
  if (!id) return `⤑`; // omit the part if the id is null, we're not in an active task/step/action
  // return `[${label} ${icon ? icon : ""} #${shortId(id)}]`;
  return `[${icon || ""} #${shortId(id)}${label ? " " : ""}${label || ""}]`;
}

function shortId(id: string | null): string {
  if (!id) return "-";
  return id.slice(-4);
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
 * Get the config directory from environment or use default
 */
export function getConfigDir(): string {
  const fromEnv = process.env.BROWSERBASE_CONFIG_DIR;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  // in the future maybe we use a centralized config directory ~/.config/browserbase
  return path.resolve(process.cwd(), ".browserbase");
}

/**
 * Format a prompt preview from LLM messages for logging.
 * Extracts the last user message and formats it for display.
 * Accepts generic message arrays to avoid tight coupling with specific LLM client types.
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

  // Add suffix for tools/schema
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
 * Extract a text preview from CUA-style messages (Anthropic, OpenAI, Google formats).
 * Returns the last user message content truncated to maxLen characters.
 */
export function formatCuaPromptPreview(
  messages: Array<{ role?: string; content?: unknown; parts?: unknown[] }>,
  maxLen = 100,
): string | undefined {
  const lastUserMsg = messages.filter((m) => m.role === "user").pop();
  if (!lastUserMsg) return undefined;

  let text: string | undefined;

  // Handle string content directly
  if (typeof lastUserMsg.content === "string") {
    text = lastUserMsg.content;
  }
  // Handle Google-style parts array
  else if (Array.isArray(lastUserMsg.parts)) {
    const firstPart = lastUserMsg.parts[0] as { text?: string } | undefined;
    text = firstPart?.text;
  }
  // Handle array content (Anthropic/OpenAI multipart)
  else if (Array.isArray(lastUserMsg.content)) {
    text = "[multipart message]";
  }

  if (!text) return undefined;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * Format CUA response output for logging.
 * Handles multiple formats flexibly:
 * - Anthropic/OpenAI: Array of { type, text?, name? }
 * - Google: { candidates: [{ content: { parts: [...] } }] }
 * - Or direct array of parts
 */
export function formatCuaResponsePreview(
  output: unknown,
  maxLen = 100,
): string {
  // Handle Google-style response with candidates
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
      // Text content (various formats)
      if (i.text) return i.text.slice(0, 50);
      if (i.type === "text" && typeof i.text === "string")
        return i.text.slice(0, 50);
      // Tool/function calls (various formats)
      if (i.functionCall?.name) return `fn:${i.functionCall.name}`;
      if (i.type === "tool_use" && i.name) return `tool_use:${i.name}`;
      // Fallback to type if available
      if (i.type) return `[${i.type}]`;
      return "[item]";
    })
    .join(" ");

  return preview.length > maxLen ? preview.slice(0, maxLen) : preview;
}

/**
 * SessionFileLogger - static methods for flow logging with AsyncLocalStorage context
 */
export class SessionFileLogger {
  /**
   * Initialize a new logging context. Call this at the start of a session.
   */
  static init(sessionId: string, v3Options?: V3Options): void {
    const configDir = getConfigDir();
    const sessionDir = path.join(configDir, "sessions", sessionId);

    const ctx: FlowLoggerContext = {
      sessionId,
      sessionDir,
      configDir,
      logFiles: {
        agent: {
          path: path.join(sessionDir, "agent_events.log"),
          stream: null,
        },
        stagehand: {
          path: path.join(sessionDir, "stagehand_events.log"),
          stream: null,
        },
        understudy: {
          path: path.join(sessionDir, "understudy_events.log"),
          stream: null,
        },
        cdp: { path: path.join(sessionDir, "cdp_events.log"), stream: null },
        llm: { path: path.join(sessionDir, "llm_events.log"), stream: null },
      },
      initPromise: Promise.resolve(),
      initialized: false,
      // sessionId is set once at init and never changes
      // taskId is null until agent.execute starts
      agentTaskId: null,
      stagehandStepId: null,
      stagehandStepLabel: null,
      understudyActionId: null,
      understudyActionLabel: null,
      understudyActionStartTime: null,
      stagehandStepStartTime: null,
      // Task metrics - null until a task starts
      agentTaskStartTime: null,
      agentTaskLlmRequests: 0,
      agentTaskCdpEvents: 0,
      agentTaskLlmInputTokens: 0,
      agentTaskLlmOutputTokens: 0,
    };

    // Store init promise for awaiting in writeToFile
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

      for (const logFile of Object.values(ctx.logFiles)) {
        try {
          logFile.stream = fs.createWriteStream(logFile.path, { flags: "a" });
        } catch {
          // Fail silently
        }
      }

      ctx.initialized = true;
    } catch {
      // Fail silently
    }
  }

  private static async writeToFile(
    logFile: LogFile,
    message: string,
  ): Promise<void> {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    await ctx.initPromise;

    if (!ctx.initialized || !logFile.stream) {
      return;
    }

    try {
      logFile.stream.write(message + "\n", (err) => {
        if (err) {
          // Fail silently
        }
      });
    } catch {
      // Fail silently
    }
  }

  static async close(): Promise<void> {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    await ctx.initPromise;

    const closePromises: Promise<void>[] = [];

    for (const logFile of Object.values(ctx.logFiles)) {
      if (logFile.stream) {
        closePromises.push(
          new Promise((resolve) => {
            logFile.stream!.end(() => {
              logFile.stream = null;
              resolve();
            });
          }),
        );
      }
    }

    try {
      await Promise.all(closePromises);
    } catch {
      // Fail silently
    }

    SessionFileLogger.logAgentTaskCompleted();
  }

  static get sessionId(): string | null {
    return loggerContext.getStore()?.sessionId ?? null;
  }

  static get sessionDir(): string | null {
    return loggerContext.getStore()?.sessionDir ?? null;
  }

  /**
   * Get the current logger context object. This can be captured and passed
   * to callbacks that run outside the AsyncLocalStorage context (like WebSocket handlers).
   * Updates to the context (taskId, stepId, etc.) will be visible through this reference.
   */
  static getContext(): FlowLoggerContext | null {
    return loggerContext.getStore() ?? null;
  }

  private static buildLogLine(
    ctx: FlowLoggerContext,
    options: {
      includeTask?: boolean;
      includeStep?: boolean;
      includeAction?: boolean;
    },
    details: string,
  ): string {
    const {
      includeAction = true,
      includeStep = true,
      includeTask = true,
    } = options;
    const parts: string[] = [];
    if (includeTask) {
      parts.push(formatTag("", ctx.agentTaskId, "🅰"));
    }
    if (includeStep) {
      parts.push(formatTag(ctx.stagehandStepLabel, ctx.stagehandStepId, "🆂"));
    }
    if (includeAction) {
      parts.push(
        formatTag(ctx.understudyActionLabel, ctx.understudyActionId, "🆄"),
      );
    }
    // parts[parts.length - 1] = parts[parts.length - 1].replace("[", "⟦").replace("]", "⟧");  // try and higlight the last tag so it stands out visually (imperfect)
    const full_line = `${formatTimestamp()} ${parts.join(" ")} ${details}`;

    // Remove unescaped " and ' characters, but leave those preceded by a backslash (\)
    const without_quotes = full_line
      .replace(/([^\\])["']/g, "$1") // remove " or ' if not preceded by \
      .replace(/^["']|["']$/g, "") // also remove leading/trailing " or ' at string ends (not preceded by \)
      .trim();

    return without_quotes;
  }

  /**
   * Start a new task and log it. Call this when agent.execute() begins.
   * Sets taskId to a new UUID, resets metrics, and logs the start event.
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
    ctx.agentTaskId = uuidv7();
    ctx.stagehandStepId = null;
    ctx.stagehandStepLabel = null;
    ctx.stagehandStepStartTime = null;
    ctx.understudyActionId = null;
    ctx.understudyActionLabel = null;
    ctx.agentTaskStartTime = Date.now();
    ctx.agentTaskLlmRequests = 0;
    ctx.agentTaskCdpEvents = 0;
    ctx.agentTaskLlmInputTokens = 0;
    ctx.agentTaskLlmOutputTokens = 0;

    // Log the start event
    const message = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: false, includeAction: false },
      `▷ ${invocation}(${formatArgs(args)})`,
    );
    SessionFileLogger.writeToFile(ctx.logFiles.agent, message).then();
  }

  /**
   * Log task completion with metrics summary. Call this after agent.execute() completes.
   * Sets taskId back to null.
   */
  static logAgentTaskCompleted(options?: { cacheHit?: boolean }): void {
    const ctx = loggerContext.getStore();
    if (ctx && ctx.agentTaskStartTime) {
      const durationMs = Date.now() - ctx.agentTaskStartTime;
      const durationSec = (durationMs / 1000).toFixed(1);

      const llmStats = options?.cacheHit
        ? `${ctx.agentTaskLlmRequests} LLM calls [CACHE HIT, NO LLM NEEDED]`
        : `${ctx.agentTaskLlmRequests} LLM calls ꜛ${ctx.agentTaskLlmInputTokens} ꜜ${ctx.agentTaskLlmOutputTokens} tokens`;
      const details = `✓ Agent.execute() DONE in ${durationSec}s | ${llmStats} | ${ctx.agentTaskCdpEvents} CDP msgs`;

      const message = SessionFileLogger.buildLogLine(
        ctx,
        { includeTask: true, includeStep: false, includeAction: false },
        details,
      );
      SessionFileLogger.writeToFile(ctx.logFiles.agent, message).then();

      // Clear task context - no active task
      ctx.agentTaskId = null;
      ctx.stagehandStepId = null;
      ctx.understudyActionId = null;
      ctx.stagehandStepLabel = null;
      ctx.understudyActionLabel = null;
      ctx.understudyActionStartTime = null;
      ctx.agentTaskStartTime = null;
    }
  }

  static logUnderstudyActionCompleted(): void {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    const durationMs = ctx.understudyActionStartTime
      ? Date.now() - ctx.understudyActionStartTime
      : 0;
    const durationSec = (durationMs / 1000).toFixed(2);

    const details = `✓ ${ctx.understudyActionLabel} completed in ${durationSec}s`;
    const message = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: true },
      details,
    );
    SessionFileLogger.writeToFile(ctx.logFiles.understudy, message).then();

    // Clear action context
    ctx.understudyActionId = null;
    ctx.understudyActionLabel = null;
  }

  // --- Logging methods ---

  static logStagehandStepEvent({
    // log stagehand-level high-level API calls like: Act, Observe, Extract, Navigate
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

    // leave parent task id null/untouched for now, stagehand steps called directly dont always have a parent task, maybe worth randomizing the task id when a step starts to make it easier to correlate steps to tasks?
    // ctx.agentTaskId = uuidv7();

    ctx.stagehandStepId = uuidv7();
    ctx.stagehandStepLabel = label.toUpperCase();
    ctx.stagehandStepStartTime = Date.now();
    ctx.understudyActionId = null;
    ctx.understudyActionLabel = null;
    ctx.understudyActionStartTime = null;

    const message = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: false },
      `▷ ${invocation}(${formatArgs(args)})`,
    );
    SessionFileLogger.writeToFile(ctx.logFiles.stagehand, message).then();

    return ctx.stagehandStepId;
  }

  static logStagehandStepCompleted(): void {
    const ctx = loggerContext.getStore();
    if (!ctx || !ctx.stagehandStepId) return;

    const durationMs = ctx.stagehandStepStartTime
      ? Date.now() - ctx.stagehandStepStartTime
      : 0;
    const durationSec = (durationMs / 1000).toFixed(2);
    const label = ctx.stagehandStepLabel || "STEP";

    const message = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: false },
      `✓ ${label} completed in ${durationSec}s`,
    );
    SessionFileLogger.writeToFile(ctx.logFiles.stagehand, message).then();

    // Clear step context
    ctx.stagehandStepId = null;
    ctx.stagehandStepLabel = null;
    ctx.stagehandStepStartTime = null;
    ctx.understudyActionId = null;
    ctx.understudyActionLabel = null;
    ctx.understudyActionStartTime = null;
  }

  static logUnderstudyActionEvent({
    // log understudy-level browser action calls like: Click, Type, Scroll
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

    // THESE ARE NOT NEEDED, it's possible for understudy methods to be called directly without going through stagehand.act/observe/extract or agent.execute
    // ctx.agentTaskId = ctx.agentTaskId || uuidv7();
    // ctx.stagehandStepId = ctx.stagehandStepId || uuidv7();

    ctx.understudyActionId = uuidv7();
    ctx.understudyActionLabel = actionType
      .toUpperCase()
      .replace("UNDERSTUDY.", "")
      .replace("PAGE.", "");

    ctx.understudyActionStartTime = Date.now();

    const details: string[] = [];
    if (target) details.push(`target=${target}`);
    const argString = formatArgs(args);
    if (argString) details.push(`args=[${argString}]`);

    const message = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: true },
      `▷ ${actionType}(${details.join(", ")})`,
    );
    SessionFileLogger.writeToFile(ctx.logFiles.understudy, message).then();

    return ctx.understudyActionId;
  }

  static logCdpCallEvent(
    {
      // log low-level CDP browser calls and events like: Page.getDocument, Runtime.evaluate, etc.
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
    ctx.agentTaskCdpEvents++;

    // Filter out CDP enable calls - they're too noisy and not useful for debugging
    if (method.endsWith(".enable") || method === "enable") {
      return;
    }

    const argsStr = params ? formatArgs(params) : "";
    const call = argsStr ? `${method}(${argsStr})` : `${method}()`;
    const details = `${formatTag("CDP", targetId || "0000", "🅲")} ⏵ ${call}`;

    const rawMessage = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: true },
      details,
    );
    const truncatedIds = truncateCdpIds(rawMessage);
    const message =
      truncatedIds.length > 140
        ? `${truncatedIds.slice(0, 137)}…`
        : truncatedIds;

    SessionFileLogger.writeToFile(ctx.logFiles.cdp, message).then();
  }

  static logCdpMessageEvent(
    {
      // log CDP events received asynchronously from the browser
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

    // Filter out noisy events that aren't useful for debugging
    const noisyEvents = [
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
    if (noisyEvents.includes(method)) {
      return;
    }

    const argsStr = params ? formatArgs(params) : "";
    const event = argsStr ? `${method}(${argsStr})` : `${method}`;
    const details = `${formatTag("CDP", targetId ? targetId.slice(-4) : "????", "🅲")} ⏴ ${event}`;

    const rawMessage = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: true },
      details,
    );
    const truncatedIds = truncateCdpIds(rawMessage);
    const message =
      truncatedIds.length > 140
        ? `${truncatedIds.slice(0, 137)}…`
        : truncatedIds;

    SessionFileLogger.writeToFile(ctx.logFiles.cdp, message).then();
  }

  static logLlmRequest(
    {
      // log outgoing LLM API requests
      requestId,
      model,
      prompt,
    }: {
      requestId: string;
      model: string;
      operation: string; // reserved for future use
      prompt?: string;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Track LLM requests for task metrics
    ctx.agentTaskLlmRequests++;

    const promptStr = prompt ? ` ${truncateConversation(prompt)}` : "";
    const details = `${formatTag("LLM", requestId, "🧠")} ${model} ⏴${promptStr}`;

    const rawMessage = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: false },
      details,
    );
    // Temporarily increased limit for debugging
    const message =
      rawMessage.length > 500 ? `${rawMessage.slice(0, 499)}…` : rawMessage;

    SessionFileLogger.writeToFile(ctx.logFiles.llm, message).then();
  }

  static logLlmResponse(
    {
      // log incoming LLM API responses
      requestId,
      model,
      output,
      inputTokens,
      outputTokens,
    }: {
      requestId: string;
      model: string;
      operation: string; // reserved for future use
      output?: string;
      inputTokens?: number;
      outputTokens?: number;
    },
    explicitCtx?: FlowLoggerContext | null,
  ): void {
    const ctx = explicitCtx ?? loggerContext.getStore();
    if (!ctx) return;

    // Track tokens for task metrics
    ctx.agentTaskLlmInputTokens += inputTokens ?? 0;
    ctx.agentTaskLlmOutputTokens += outputTokens ?? 0;

    const tokens =
      inputTokens !== undefined || outputTokens !== undefined
        ? ` ꜛ${inputTokens ?? 0} ꜜ${outputTokens ?? 0} |`
        : "";
    const outputStr = output ? ` ${truncateConversation(output)}` : "";
    const details = `${formatTag("LLM", requestId, "🧠")} ${model} ↳${tokens}${outputStr}`;

    const rawMessage = SessionFileLogger.buildLogLine(
      ctx,
      { includeTask: true, includeStep: true, includeAction: false },
      details,
    );
    // Temporarily increased limit for debugging
    const message =
      rawMessage.length > 500 ? `${rawMessage.slice(0, 499)}…` : rawMessage;

    SessionFileLogger.writeToFile(ctx.logFiles.llm, message).then();
  }

  /**
   * Create middleware for wrapping language models with LLM call logging.
   * Use with wrapLanguageModel from the AI SDK.
   * This is vibecoded and a bit messy, but it's a quick way to get LLM
   * logging working and in a useful format for devs watching the terminal in realtime.
   * TODO: Refactor this to use a proper span-based tracing system like OpenTelemetry and clean up/reduce all the parsing/reformatting logic.
   */
  static createLlmLoggingMiddleware(modelId: string): {
    wrapGenerate: (options: {
      doGenerate: () => Promise<{
        text?: string;
        toolCalls?: unknown[];
        usage?: { inputTokens?: number; outputTokens?: number };
      }>;
      params: { prompt?: Array<{ role: string; content?: unknown[] }> };
    }) => Promise<{
      text?: string;
      toolCalls?: unknown[];
      usage?: { inputTokens?: number; outputTokens?: number };
    }>;
  } {
    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        // Capture context at the start of the call to preserve step/action context
        const ctx = SessionFileLogger.getContext();

        const llmRequestId = uuidv7();

        const p = params as {
          prompt?: unknown[];
          tools?: unknown[];
          schema?: unknown;
        };

        // Count tools
        const toolCount = Array.isArray(p.tools) ? p.tools.length : 0;

        // Check for images in any message
        // const hasImage =
        //   p.prompt?.some((m: unknown) => {
        //     const msg = m as { content?: unknown[] };
        //     if (!Array.isArray(msg.content)) return false;
        //     return msg.content.some((c: unknown) => {
        //       const part = c as { type?: string };
        //       return part.type === "image";
        //     });
        //   }) ?? false;

        // // Check for schema (structured output)
        // const hasSchema = !!p.schema;

        // Find the last non-system message to show the newest content (tool result, etc.)
        const nonSystemMessages = (p.prompt ?? []).filter((m: unknown) => {
          const msg = m as { role?: string };
          return msg.role !== "system";
        });
        const lastMsg = nonSystemMessages[nonSystemMessages.length - 1] as
          | Record<string, unknown>
          | undefined;
        const lastRole = (lastMsg?.role as string) ?? "?";

        // Extract content from last message - handle various formats
        let lastContent = "";
        let toolName = "";

        if (lastMsg) {
          // Check for tool result format: content → [{type: "tool-result", toolName, output: {type, value: [...]}}]
          if (lastMsg.content && Array.isArray(lastMsg.content)) {
            for (const part of lastMsg.content) {
              const item = part as Record<string, unknown>;
              if (item.type === "tool-result") {
                toolName = (item.toolName as string) || "";

                // output is directly on the tool-result item
                const output = item.output as
                  | Record<string, unknown>
                  | undefined;

                if (output) {
                  if (output.type === "json" && output.value) {
                    // JSON result like goto, scroll
                    lastContent = JSON.stringify(output.value).slice(0, 150);
                  } else if (Array.isArray(output.value)) {
                    // Array of content parts (text, images)
                    const parts: string[] = [];
                    for (const v of output.value) {
                      const vItem = v as Record<string, unknown>;
                      if (vItem.type === "text" && vItem.text) {
                        parts.push(vItem.text as string);
                      } else if (
                        vItem.mediaType &&
                        typeof vItem.data === "string"
                      ) {
                        // Image data
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

        // Fallback: if still no content, stringify what we have for debugging
        if (!lastContent && lastMsg) {
          try {
            const debugStr = JSON.stringify(lastMsg, (key, value) => {
              // Truncate long strings (like base64 images)
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

        // Build preview: role + tool name + truncated content + metadata
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

        // Extract output - handle various response formats
        let outputPreview = "";
        const res = result as {
          text?: string;
          content?: unknown;
          toolCalls?: unknown[];
        };
        if (res.text) {
          outputPreview = res.text;
        } else if (res.content) {
          // AI SDK may return content as string or array
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
          // Fallback: try to stringify relevant parts of the result
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
