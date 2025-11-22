import type { V3 } from "../v3";
import type { V3Options, LogLine } from "../types/public";
import { randomUUID } from "crypto";

export interface SessionEntry {
  sessionId: string;
  stagehand: V3 | null;
  config: V3Options;
  loggerRef: { current?: (message: LogLine) => void };
  createdAt: Date;
}

export class SessionManager {
  private sessions: Map<string, SessionEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = 30_000) {
    this.sessions = new Map();
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  /**
   * Create a new session with the given config
   */
  createSession(config: V3Options): string {
    const sessionId = randomUUID();

    this.sessions.set(sessionId, {
      sessionId,
      stagehand: null, // Will be created on first use
      config,
      loggerRef: {},
      createdAt: new Date(),
    });

    return sessionId;
  }

  /**
   * Get or create a Stagehand instance for a session
   */
  async getStagehand(
    sessionId: string,
    logger?: (message: LogLine) => void,
  ): Promise<V3> {
    const entry = this.sessions.get(sessionId);

    if (!entry) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update logger reference if provided
    if (logger) {
      entry.loggerRef.current = logger;
    }

    // If stagehand instance doesn't exist yet, create it
    if (!entry.stagehand) {
      // Import V3 dynamically to avoid circular dependency
      const { V3: V3Class } = await import("../v3");

      // Create options with dynamic logger
      const options: V3Options = {
        ...entry.config,
        logger: (message: LogLine) => {
          // Use the dynamic logger ref so we can update it per request
          if (entry.loggerRef.current) {
            entry.loggerRef.current(message);
          }
          // Also call the original logger if it exists
          if (entry.config.logger) {
            entry.config.logger(message);
          }
        },
      };

      entry.stagehand = new V3Class(options);
      await entry.stagehand.init();
    } else if (logger) {
      // Update logger for existing instance
      entry.loggerRef.current = logger;
    }

    return entry.stagehand;
  }

  /**
   * Get session config without creating Stagehand instance
   */
  getSessionConfig(sessionId: string): V3Options | null {
    const entry = this.sessions.get(sessionId);
    return entry ? entry.config : null;
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * End a session and cleanup
   */
  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);

    if (!entry) {
      return; // Already deleted or never existed
    }

    // Close the stagehand instance if it exists
    if (entry.stagehand) {
      try {
        await entry.stagehand.close();
      } catch (error) {
        console.error(`Error closing stagehand for session ${sessionId}:`, error);
      }
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60_000);
  }

  /**
   * Cleanup sessions that haven't been used in TTL time
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, entry] of this.sessions.entries()) {
      const age = now - entry.createdAt.getTime();
      if (age > this.ttlMs) {
        expiredSessions.push(sessionId);
      }
    }

    // End all expired sessions
    for (const sessionId of expiredSessions) {
      console.log(`Cleaning up expired session: ${sessionId}`);
      await this.endSession(sessionId);
    }
  }

  /**
   * Stop cleanup interval and close all sessions
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.endSession(id)));
  }
}
