import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { V3Options } from "./types/public";

interface SessionFileLoggerConfig {
  sessionId: string;
  configDir: string;
  v3Options?: V3Options;
}

interface LogFile {
  path: string;
  stream: fs.WriteStream | null;
}

/**
 * SessionFileLogger manages writing logs to session-specific files.
 * All filesystem operations are async and fail silently to avoid blocking execution.
 */
export class SessionFileLogger {
  private sessionId: string;
  private sessionDir: string;
  private configDir: string;
  private logFiles: {
    agent: LogFile;
    stagehand: LogFile;
    understudy: LogFile;
    cdp: LogFile;
  };
  private initialized = false;

  constructor(config: SessionFileLoggerConfig) {
    this.sessionId = config.sessionId;
    this.configDir = config.configDir;
    this.sessionDir = path.join(
      this.configDir,
      "sessions",
      this.sessionId,
    );

    // Initialize log file paths (but don't create streams yet)
    this.logFiles = {
      agent: { path: path.join(this.sessionDir, "agent_events.log"), stream: null },
      stagehand: { path: path.join(this.sessionDir, "stagehand_events.log"), stream: null },
      understudy: { path: path.join(this.sessionDir, "understudy_events.log"), stream: null },
      cdp: { path: path.join(this.sessionDir, "cdp_events.log"), stream: null },
    };

    // Initialize asynchronously (non-blocking)
    this.initAsync(config.v3Options).catch(() => {
      // Fail silently
    });
  }

  private async initAsync(v3Options?: V3Options): Promise<void> {
    try {
      // Create session directory
      await fs.promises.mkdir(this.sessionDir, { recursive: true });

      // Create session.json with sanitized options
      if (v3Options) {
        const sanitizedOptions = this.sanitizeOptions(v3Options);
        const sessionJsonPath = path.join(this.sessionDir, "session.json");
        await fs.promises.writeFile(
          sessionJsonPath,
          JSON.stringify(sanitizedOptions, null, 2),
          "utf-8",
        );
      }

      // Create symlink to latest session
      const latestLink = path.join(this.configDir, "sessions", "latest");
      try {
        // Remove existing symlink if it exists
        try {
          await fs.promises.unlink(latestLink);
        } catch {
          // Ignore if doesn't exist
        }
        // Create new symlink (relative path for portability)
        await fs.promises.symlink(this.sessionId, latestLink, "dir");
      } catch {
        // Symlink creation can fail on Windows or due to permissions
        // Fail silently
      }

      // Create write streams for log files
      for (const [, logFile] of Object.entries(this.logFiles)) {
        try {
          logFile.stream = fs.createWriteStream(logFile.path, { flags: "a" });
          // Don't wait for drain events - let Node.js buffer handle it
        } catch {
          // Fail silently if stream creation fails
        }
      }

      this.initialized = true;
    } catch {
      // Fail silently - logging should never crash the application
    }
  }

  /**
   * Sanitize V3Options by replacing sensitive values with ******
   */
  private sanitizeOptions(options: V3Options): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...options };

    // List of keys that may contain sensitive data
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

    return sanitizeValue(sanitized) as Record<string, unknown>;
  }

  /**
   * Write a log line to the agent events log file
   */
  writeAgentLog(message: string): void {
    this.writeToFile(this.logFiles.agent, message);
  }

  /**
   * Write a log line to the stagehand events log file
   */
  writeStagehandLog(message: string): void {
    this.writeToFile(this.logFiles.stagehand, message);
  }

  /**
   * Write a log line to the understudy events log file
   */
  writeUnderstudyLog(message: string): void {
    this.writeToFile(this.logFiles.understudy, message);
  }

  /**
   * Write a log line to the CDP events log file
   */
  writeCdpLog(message: string): void {
    this.writeToFile(this.logFiles.cdp, message);
  }

  /**
   * Write to a log file asynchronously (non-blocking)
   */
  private writeToFile(logFile: LogFile, message: string): void {
    if (!this.initialized || !logFile.stream) {
      return; // Silently skip if not initialized
    }

    try {
      // Non-blocking write - don't await or check for drain
      // Node.js will buffer and handle backpressure internally
      logFile.stream.write(message + "\n", (err) => {
        if (err) {
          // Fail silently - logging errors should not crash the app
        }
      });
    } catch {
      // Fail silently
    }
  }

  /**
   * Close all log streams (call on shutdown)
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [, logFile] of Object.entries(this.logFiles)) {
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
  }

  /**
   * Get the session directory path
   */
  getSessionDir(): string {
    return this.sessionDir;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Get the config directory from environment or use default
 */
export function getConfigDir(): string {
  const fromEnv = process.env.BROWSERBASE_CONFIG_DIR;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  // Default to .browserbase in current working directory
  return path.resolve(process.cwd(), ".browserbase");
}

/**
 * Create a session file logger instance
 */
export function createSessionFileLogger(
  sessionId: string,
  v3Options?: V3Options,
): SessionFileLogger {
  const configDir = getConfigDir();
  return new SessionFileLogger({
    sessionId,
    configDir,
    v3Options,
  });
}
