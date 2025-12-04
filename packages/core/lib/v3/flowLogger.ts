import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { V3Options } from "./types/public";

const MAX_ARG_LENGTH = 500;

interface LogFile {
  path: string;
  stream: fs.WriteStream | null;
}

interface FlowLoggerContext {
  sessionId: string;
  sessionDir: string;
  configDir: string;
  logFiles: {
    agent: LogFile;
    stagehand: LogFile;
    understudy: LogFile;
    cdp: LogFile;
  };
  initPromise: Promise<void>;
  initialized: boolean;
  // Flow context
  taskId: string | null;
  stepId: string | null;
  actionId: string | null;
  stepLabel: string | null;
  actionLabel: string | null;
}

const loggerContext = new AsyncLocalStorage<FlowLoggerContext>();

function generateId(label: string): string {
  try {
    return randomUUID();
  } catch {
    const fallback =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${label}-${Math.floor(Math.random() * 1e6)}`;
    return fallback;
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_ARG_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ARG_LENGTH)}…`;
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

function formatTag(label: string, id: string | null): string {
  return `[${label} #${shortId(id)}]`;
}

function formatCdpTag(sessionId?: string | null): string {
  if (!sessionId) return "[CDP #????]";
  return `[CDP #${shortId(sessionId).toUpperCase()}]`;
}

function shortId(id: string | null): string {
  if (!id) return "-";
  return id.slice(-4);
}

function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
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
  return path.resolve(process.cwd(), ".browserbase");
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
        agent: { path: path.join(sessionDir, "agent_events.log"), stream: null },
        stagehand: { path: path.join(sessionDir, "stagehand_events.log"), stream: null },
        understudy: { path: path.join(sessionDir, "understudy_events.log"), stream: null },
        cdp: { path: path.join(sessionDir, "cdp_events.log"), stream: null },
      },
      initPromise: Promise.resolve(),
      initialized: false,
      taskId: null,
      stepId: null,
      actionId: null,
      stepLabel: null,
      actionLabel: null,
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

    SessionFileLogger.clearFlowContext();
  }

  static get sessionId(): string | null {
    return loggerContext.getStore()?.sessionId ?? null;
  }

  static get sessionDir(): string | null {
    return loggerContext.getStore()?.sessionDir ?? null;
  }

  // --- Flow context methods ---

  private static ensureTaskContext(ctx: FlowLoggerContext): void {
    if (!ctx.taskId) {
      ctx.taskId = generateId("sesh");
    }
  }

  private static ensureStepContext(
    ctx: FlowLoggerContext,
    defaultLabel?: string,
  ): void {
    if (defaultLabel) {
      ctx.stepLabel = defaultLabel.toUpperCase();
    }
    if (!ctx.stepLabel) {
      ctx.stepLabel = "STEP";
    }
    if (!ctx.stepId) {
      ctx.stepId = generateId("step");
    }
  }

  private static ensureActionContext(
    ctx: FlowLoggerContext,
    defaultLabel?: string,
  ): void {
    if (defaultLabel) {
      ctx.actionLabel = defaultLabel.toUpperCase();
    }
    if (!ctx.actionLabel) {
      ctx.actionLabel = "ACTION";
    }
    if (!ctx.actionId) {
      ctx.actionId = generateId("action");
    }
  }

  private static buildPrefix(
    ctx: FlowLoggerContext,
    options: {
      includeAction?: boolean;
      includeStep?: boolean;
      includeTask?: boolean;
    } = {},
  ): string {
    const { includeAction = true, includeStep = true, includeTask = true } = options;
    const parts: string[] = [];
    if (includeTask) {
      SessionFileLogger.ensureTaskContext(ctx);
      parts.push(formatTag("SESH", ctx.taskId));
    }
    if (includeStep) {
      SessionFileLogger.ensureStepContext(ctx);
      parts.push(formatTag(ctx.stepLabel ?? "STEP", ctx.stepId));
    }
    if (includeAction) {
      SessionFileLogger.ensureActionContext(ctx);
      parts.push(formatTag(ctx.actionLabel ?? "ACTION", ctx.actionId));
    }
    parts[parts.length - 1] = parts[parts.length - 1].replace("[", "<").replace("]", ">");
    return parts.join(" ");
  }

  static clearFlowContext(): void {
    const ctx = loggerContext.getStore();
    if (ctx) {
      ctx.taskId = null;
      ctx.stepId = null;
      ctx.actionId = null;
      ctx.stepLabel = null;
      ctx.actionLabel = null;
    }
  }

  // --- Logging methods ---

  static logTaskProgress({    // log agent/session-level events like: Start, End, Execute
    invocation,
    args,
  }: {
    invocation: string;
    args?: unknown | unknown[];
  }): string {
    const ctx = loggerContext.getStore();
    if (!ctx) return generateId("sesh");

    ctx.taskId = generateId("sesh");
    ctx.stepId = null;
    ctx.actionId = null;
    ctx.stepLabel = null;
    ctx.actionLabel = null;

    const call = `${invocation}(${formatArgs(args)})`;
    const prefix = SessionFileLogger.buildPrefix(ctx, {
      includeTask: true,
      includeStep: false,
      includeAction: false,
    });
    const message = `${formatTimestamp()} ${prefix} ${call}`;

    SessionFileLogger.writeToFile(ctx.logFiles.agent, message).then();

    return ctx.taskId;
  }

  static logStepProgress({        // log stagehand-level high-level API calls like: Act, Observe, Extract, Navigate
    invocation,
    args,
    label,
  }: {
    invocation: string;
    args?: unknown | unknown[];
    label: string;
  }): string {
    const ctx = loggerContext.getStore();
    if (!ctx) return generateId("step");

    SessionFileLogger.ensureTaskContext(ctx);
    ctx.stepId = generateId("step");
    ctx.stepLabel = label.toUpperCase();
    ctx.actionId = null;
    ctx.actionLabel = null;

    const call = `${invocation}(${formatArgs(args)})`;
    const prefix = SessionFileLogger.buildPrefix(ctx, {
      includeTask: true,
      includeStep: true,
      includeAction: false,
    });
    const message = `${formatTimestamp()} ${prefix} ${call}`;

    SessionFileLogger.writeToFile(ctx.logFiles.stagehand, message).then();

    return ctx.stepId;
  }

  static logActionProgress({     // log understudy-level browser action calls like: Click, Type, Scroll
    actionType,
    target,
    args,
  }: {
    actionType: string;
    target?: string;
    args?: unknown | unknown[];
  }): string {
    const ctx = loggerContext.getStore();
    if (!ctx) return generateId("action");

    SessionFileLogger.ensureTaskContext(ctx);
    SessionFileLogger.ensureStepContext(ctx);
    ctx.actionId = generateId("action");
    ctx.actionLabel = actionType.toUpperCase();

    const details: string[] = [actionType];
    if (target) {
      details.push(`target=${target}`);
    }
    const argString = formatArgs(args);
    if (argString) {
      details.push(`args=[${argString}]`);
    }

    const prefix = SessionFileLogger.buildPrefix(ctx, {
      includeTask: true,
      includeStep: true,
      includeAction: true,
    });
    const message = `${formatTimestamp()} ${prefix} ${details.join(" ")}`;

    SessionFileLogger.writeToFile(ctx.logFiles.understudy, message).then();

    return ctx.actionId;
  }

  static logCdpMessage({      // log low-level CDP browser calls and events like: Page.getDocument, Runtime.evaluate, etc.
    method,
    params,
    sessionId,
  }: {
    method: string;
    params?: object;
    sessionId?: string | null;
  }): void {
    const ctx = loggerContext.getStore();
    if (!ctx) return;

    const argsStr = params ? formatArgs(params) : "";
    const call = argsStr ? `${method}(${argsStr})` : `${method}()`;
    const prefix = SessionFileLogger.buildPrefix(ctx, {
      includeTask: true,
      includeStep: true,
      includeAction: true,
    });
    const timestamp = formatTimestamp();
    const rawMessage = `${timestamp} ${prefix} ${formatCdpTag(sessionId)} ${call}`;
    const message =
      rawMessage.length > 140 ? `${rawMessage.slice(0, 137)}...` : rawMessage;

    SessionFileLogger.writeToFile(ctx.logFiles.cdp, message).then();
  }
}
