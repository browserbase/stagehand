import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import { BrowserSession, SessionCreateRequest, Viewport } from "./types";

/**
 * Generates a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * BrowserSessionManager
 *
 * Manages multiple Stagehand browser instances by session ID.
 * Handles creation, retrieval, and cleanup of browser sessions.
 */
export class BrowserSessionManager {
  private sessions: Map<string, BrowserSession> = new Map();

  /**
   * Create a new browser session
   */
  async createSession(options?: SessionCreateRequest): Promise<BrowserSession> {
    const sessionId = generateSessionId();

    const stagehand = new Stagehand({
      env: options?.env ?? "LOCAL",
      apiKey: options?.browserbaseApiKey,
      projectId: options?.browserbaseProjectId,
      verbose: 1,
      localBrowserLaunchOptions: options?.viewport
        ? {
            viewport: {
              width: options.viewport.width,
              height: options.viewport.height,
            },
          }
        : undefined,
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];

    const session: BrowserSession = {
      id: sessionId,
      stagehand,
      page,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * Get an existing session by ID
   */
  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Destroy a session and close its browser
   */
  async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      await session.stagehand.close();
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get the page for a session
   */
  async getPage(sessionId: string): Promise<Page | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    // Always get the active page in case it changed
    return await session.stagehand.context.awaitActivePage();
  }

  /**
   * Get the viewport for a session
   */
  async getViewport(sessionId: string): Promise<Viewport | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const page = await session.stagehand.context.awaitActivePage();
    try {
      const { w, h } = await page
        .mainFrame()
        .evaluate<{
          w: number;
          h: number;
        }>("({ w: window.innerWidth, h: window.innerHeight })");
      return { width: w, height: h };
    } catch {
      return { width: 1280, height: 720 }; // Default fallback
    }
  }

  /**
   * Destroy all sessions (cleanup on server shutdown)
   */
  async destroyAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.destroySession(id)));
  }
}

// Singleton instance
export const sessionManager = new BrowserSessionManager();
