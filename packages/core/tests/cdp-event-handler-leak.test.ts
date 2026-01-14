/**
 * BUG-023: Event Handler Memory Leak in CDP Sessions
 *
 * Regression test to verify that event handlers registered on CDP sessions
 * are properly cleaned up when the session is detached.
 *
 * The fix adds cleanup of event handlers in the Target.detachedFromTarget
 * handler in cdp.ts.
 *
 * Behavior:
 * - When a CDP session is detached, all event handlers for that session should be removed
 * - This prevents memory leaks from accumulating closures over long sessions
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CdpConnection } from "../lib/v3/understudy/cdp";

// We need to access private members for testing, so we'll use type assertions
type CdpConnectionInternal = CdpConnection & {
  eventHandlers: Map<string, Set<unknown>>;
  sessions: Map<string, unknown>;
  sessionToTarget: Map<string, string>;
  inflight: Map<number, unknown>;
  onMessage(json: string): void;
};

// Helper to create a mock CdpConnection for testing
function createMockConnection(): CdpConnectionInternal {
  // Create a mock WebSocket
  const mockWs = {
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };

  // Access the private constructor via reflection
  const CdpConnectionClass = CdpConnection as unknown as {
    new (ws: unknown): CdpConnectionInternal;
  };

  // Use Object.create to bypass the private constructor
  const conn = Object.create(CdpConnectionClass.prototype) as CdpConnectionInternal;

  // Initialize private fields
  (conn as unknown as { ws: unknown }).ws = mockWs;
  (conn as unknown as { nextId: number }).nextId = 1;
  conn.inflight = new Map();
  conn.eventHandlers = new Map();
  conn.sessions = new Map();
  conn.sessionToTarget = new Map();
  (conn as unknown as { id: string | null }).id = null;
  (conn as unknown as { transportCloseHandlers: Set<unknown> }).transportCloseHandlers = new Set();

  return conn;
}

describe("BUG-023: Event handler memory leak in CDP sessions", () => {
  let conn: CdpConnectionInternal;

  beforeEach(() => {
    conn = createMockConnection();
  });

  describe("when session is detached", () => {
    it("cleans up event handlers for the detached session", () => {
      const sessionId = "test-session-123";
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Simulate attaching a session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: { targetId: "target-123" },
          },
        }),
      );

      // Register event handlers on the session
      conn._onSessionEvent(sessionId, "Page.loadEventFired", handler1);
      conn._onSessionEvent(sessionId, "Runtime.consoleAPICalled", handler2);

      // Verify handlers are registered
      expect(conn.eventHandlers.has(`${sessionId}:Page.loadEventFired`)).toBe(true);
      expect(conn.eventHandlers.has(`${sessionId}:Runtime.consoleAPICalled`)).toBe(true);
      expect(conn.eventHandlers.size).toBe(2);

      // Simulate session detachment
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );

      // Verify handlers are cleaned up
      expect(conn.eventHandlers.has(`${sessionId}:Page.loadEventFired`)).toBe(false);
      expect(conn.eventHandlers.has(`${sessionId}:Runtime.consoleAPICalled`)).toBe(false);
      expect(conn.eventHandlers.size).toBe(0);
    });

    it("only cleans up handlers for the detached session, not others", () => {
      const sessionId1 = "session-1";
      const sessionId2 = "session-2";
      const handler = vi.fn();

      // Attach both sessions
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId: sessionId1, targetInfo: { targetId: "target-1" } },
        }),
      );
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId: sessionId2, targetInfo: { targetId: "target-2" } },
        }),
      );

      // Register handlers on both sessions
      conn._onSessionEvent(sessionId1, "Page.loadEventFired", handler);
      conn._onSessionEvent(sessionId2, "Page.loadEventFired", handler);

      expect(conn.eventHandlers.size).toBe(2);

      // Detach only session 1
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId: sessionId1 },
        }),
      );

      // Session 1's handler should be gone, session 2's should remain
      expect(conn.eventHandlers.has(`${sessionId1}:Page.loadEventFired`)).toBe(false);
      expect(conn.eventHandlers.has(`${sessionId2}:Page.loadEventFired`)).toBe(true);
      expect(conn.eventHandlers.size).toBe(1);
    });

    it("handles multiple event types for the same session", () => {
      const sessionId = "multi-event-session";
      const events = [
        "Page.loadEventFired",
        "Page.domContentEventFired",
        "Runtime.consoleAPICalled",
        "Network.requestWillBeSent",
        "Network.responseReceived",
      ];

      // Attach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId: "target-multi" } },
        }),
      );

      // Register multiple event handlers
      for (const event of events) {
        conn._onSessionEvent(sessionId, event, vi.fn());
      }

      expect(conn.eventHandlers.size).toBe(5);

      // Detach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );

      // All handlers should be cleaned up
      expect(conn.eventHandlers.size).toBe(0);
      for (const event of events) {
        expect(conn.eventHandlers.has(`${sessionId}:${event}`)).toBe(false);
      }
    });

    it("handles session with no event handlers gracefully", () => {
      const sessionId = "no-handlers-session";

      // Attach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId: "target-empty" } },
        }),
      );

      // No handlers registered
      expect(conn.eventHandlers.size).toBe(0);

      // Detach session - should not throw
      expect(() => {
        conn.onMessage(
          JSON.stringify({
            method: "Target.detachedFromTarget",
            params: { sessionId },
          }),
        );
      }).not.toThrow();

      expect(conn.eventHandlers.size).toBe(0);
    });
  });

  describe("session cleanup completeness", () => {
    it("cleans up sessions, sessionToTarget, and eventHandlers together", () => {
      const sessionId = "complete-cleanup-session";
      const targetId = "target-complete";

      // Attach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId } },
        }),
      );

      // Register an event handler
      conn._onSessionEvent(sessionId, "Page.loadEventFired", vi.fn());

      // Verify all are set
      expect(conn.sessions.has(sessionId)).toBe(true);
      expect(conn.sessionToTarget.has(sessionId)).toBe(true);
      expect(conn.eventHandlers.has(`${sessionId}:Page.loadEventFired`)).toBe(true);

      // Detach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );

      // Verify all are cleaned up
      expect(conn.sessions.has(sessionId)).toBe(false);
      expect(conn.sessionToTarget.has(sessionId)).toBe(false);
      expect(conn.eventHandlers.has(`${sessionId}:Page.loadEventFired`)).toBe(false);
    });

    it("also cleans up inflight requests for the session", () => {
      const sessionId = "inflight-session";

      // Attach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId: "target-inflight" } },
        }),
      );

      // Simulate inflight request
      const mockReject = vi.fn();
      conn.inflight.set(1, {
        resolve: vi.fn(),
        reject: mockReject,
        sessionId,
        method: "Page.navigate",
        ts: Date.now(),
      });

      expect(conn.inflight.size).toBe(1);

      // Detach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );

      // Verify inflight is rejected and cleaned up
      expect(mockReject).toHaveBeenCalledWith(expect.any(Error));
      expect(conn.inflight.size).toBe(0);
    });
  });

  describe("root connection event handlers", () => {
    it("does not affect root connection event handlers (no sessionId prefix)", () => {
      const sessionId = "session-with-root";
      const rootHandler = vi.fn();

      // Register a root-level handler (no session prefix)
      conn.on("Target.targetCreated", rootHandler);

      // Attach and detach session
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId: "target-root" } },
        }),
      );
      conn._onSessionEvent(sessionId, "Page.loadEventFired", vi.fn());

      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );

      // Root handler should still exist
      expect(conn.eventHandlers.has("Target.targetCreated")).toBe(true);
      // Session handler should be gone
      expect(conn.eventHandlers.has(`${sessionId}:Page.loadEventFired`)).toBe(false);
    });
  });
});

describe("BUG-023 regression: memory leak prevention", () => {
  it("simulates long session with many iframe attach/detach cycles", () => {
    const conn = createMockConnection();
    const iframeCycles = 50;

    for (let i = 0; i < iframeCycles; i++) {
      const sessionId = `iframe-session-${i}`;
      const targetId = `iframe-target-${i}`;

      // Simulate iframe attach
      conn.onMessage(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId } },
        }),
      );

      // Register typical iframe handlers
      conn._onSessionEvent(sessionId, "Page.loadEventFired", vi.fn());
      conn._onSessionEvent(sessionId, "Page.domContentEventFired", vi.fn());
      conn._onSessionEvent(sessionId, "Runtime.executionContextCreated", vi.fn());

      // Simulate iframe detach (e.g., navigated away or removed)
      conn.onMessage(
        JSON.stringify({
          method: "Target.detachedFromTarget",
          params: { sessionId },
        }),
      );
    }

    // After all cycles, no handlers should remain
    // (Before the fix, this would be 150 leaked handlers)
    expect(conn.eventHandlers.size).toBe(0);
    expect(conn.sessions.size).toBe(0);
  });
});
