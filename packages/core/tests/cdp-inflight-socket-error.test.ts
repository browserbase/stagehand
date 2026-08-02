import { beforeEach, describe, expect, it, vi } from "vitest";
import { CdpConnection } from "../lib/v3/understudy/cdp";
import { EventEmitter } from "events";

/**
 * BUG-011 Regression Test: CDP Inflight Requests Never Cleaned Up on Socket Error
 *
 * This test verifies that when a WebSocket error or close occurs, pending CDP
 * requests in the `inflight` Map are properly rejected instead of hanging forever.
 *
 * Bug location: /packages/core/lib/v3/understudy/cdp.ts
 *
 * Without the fix:
 * - emitTransportClosed() only notifies registered handlers
 * - Inflight promises are never rejected
 * - Pending CDP requests hang forever
 *
 * With the fix:
 * - emitTransportClosed() rejects all pending inflight promises
 * - Pending CDP requests properly reject with an error
 * - Callers can handle the error and recover
 */

// Mock WebSocket that extends EventEmitter so we can simulate errors/closes
class MockWebSocket extends EventEmitter {
  public readyState = 1; // OPEN

  send(data: string) {
    // Mock send - do nothing, we'll never send a response
  }

  close() {
    this.emit("close", 1000, "");
  }
}

describe("CdpConnection inflight cleanup on socket error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects pending CDP requests when WebSocket emits error", async () => {
    // Create a mock WebSocket
    const mockWs = new MockWebSocket();

    // Access CdpConnection constructor via connect, but we need to inject our mock
    // We'll use the private constructor by accessing internals
    const conn = createMockCdpConnection(mockWs);

    // Start a CDP request that will never receive a response
    const pendingRequest = conn.send("Runtime.evaluate", {
      expression: "1 + 1",
    });

    // Verify the request is inflight
    const inflight = (conn as unknown as { inflight: Map<number, unknown> })
      .inflight;
    expect(inflight.size).toBe(1);

    // Simulate WebSocket error
    mockWs.emit("error", new Error("Connection reset by peer"));

    // The pending request should now reject (not hang)
    const TIMEOUT_MS = 500;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              "TIMEOUT: CDP request hung - inflight cleanup missing on socket error",
            ),
          ),
        TIMEOUT_MS,
      );
    });

    // With the fix: pendingRequest rejects with "CDP connection closed" error
    // Without the fix: pendingRequest hangs forever and we hit the timeout
    await expect(
      Promise.race([pendingRequest, timeoutPromise]),
    ).rejects.toThrow("CDP connection closed");

    // Verify inflight Map was cleaned up
    expect(inflight.size).toBe(0);
  });

  it("rejects pending CDP requests when WebSocket emits close", async () => {
    const mockWs = new MockWebSocket();
    const conn = createMockCdpConnection(mockWs);

    // Start multiple CDP requests
    const request1 = conn.send("Runtime.evaluate", { expression: "1" });
    const request2 = conn.send("Runtime.evaluate", { expression: "2" });
    const request3 = conn.send("DOM.getDocument", {});

    const inflight = (conn as unknown as { inflight: Map<number, unknown> })
      .inflight;
    expect(inflight.size).toBe(3);

    // Simulate WebSocket close
    mockWs.emit("close", 1006, "Connection abnormally closed");

    const TIMEOUT_MS = 500;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              "TIMEOUT: CDP request hung - inflight cleanup missing on socket close",
            ),
          ),
        TIMEOUT_MS,
      );
    });

    // All requests should reject
    await expect(
      Promise.race([request1, timeoutPromise]),
    ).rejects.toThrow("CDP connection closed");
    await expect(request2).rejects.toThrow("CDP connection closed");
    await expect(request3).rejects.toThrow("CDP connection closed");

    // Verify all inflight requests were cleaned up
    expect(inflight.size).toBe(0);
  });

  it("still calls transportCloseHandlers after rejecting inflight requests", async () => {
    const mockWs = new MockWebSocket();
    const conn = createMockCdpConnection(mockWs);

    const closeHandler = vi.fn();
    conn.onTransportClosed(closeHandler);

    // Start a request
    const pendingRequest = conn.send("Runtime.evaluate", { expression: "1" });

    // Simulate error
    mockWs.emit("error", new Error("Network error"));

    // Wait for the request to reject
    await expect(pendingRequest).rejects.toThrow("CDP connection closed");

    // Verify the close handler was still called
    expect(closeHandler).toHaveBeenCalledTimes(1);
    expect(closeHandler).toHaveBeenCalledWith(
      expect.stringContaining("socket-error"),
    );
  });

  it("handles empty inflight Map gracefully on socket error", async () => {
    const mockWs = new MockWebSocket();
    const conn = createMockCdpConnection(mockWs);

    const closeHandler = vi.fn();
    conn.onTransportClosed(closeHandler);

    // No pending requests - just emit error
    mockWs.emit("error", new Error("Connection timeout"));

    // Should not throw, handler should still be called
    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it("includes error reason in rejection message", async () => {
    const mockWs = new MockWebSocket();
    const conn = createMockCdpConnection(mockWs);

    const pendingRequest = conn.send("Runtime.evaluate", { expression: "1" });

    // Simulate error with specific message
    mockWs.emit("error", new Error("ECONNRESET"));

    await expect(pendingRequest).rejects.toThrow("ECONNRESET");
  });
});

/**
 * Helper to create a CdpConnection with a mock WebSocket.
 * This accesses the private constructor pattern.
 */
function createMockCdpConnection(mockWs: MockWebSocket): CdpConnection {
  // CdpConnection has a private constructor that takes a WebSocket
  // We need to bypass the static connect() method and instantiate directly
  // Access via prototype manipulation

  // Create a minimal object that mimics the constructor behavior
  const conn = Object.create(CdpConnection.prototype);

  // Initialize private fields
  (conn as unknown as Record<string, unknown>).ws = mockWs;
  (conn as unknown as Record<string, unknown>).nextId = 1;
  (conn as unknown as Record<string, unknown>).inflight = new Map();
  (conn as unknown as Record<string, unknown>).eventHandlers = new Map();
  (conn as unknown as Record<string, unknown>).sessions = new Map();
  (conn as unknown as Record<string, unknown>).sessionToTarget = new Map();
  (conn as unknown as Record<string, unknown>).id = null;
  (conn as unknown as Record<string, unknown>).transportCloseHandlers =
    new Set();

  // Set up WebSocket event handlers (same as constructor)
  mockWs.on("close", (code: number, reason: string) => {
    const why = `socket-close code=${code} reason=${String(reason || "")}`;
    (
      conn as unknown as { emitTransportClosed: (why: string) => void }
    ).emitTransportClosed(why);
  });

  mockWs.on("error", (err: Error) => {
    const why = `socket-error ${err?.message ?? String(err)}`;
    (
      conn as unknown as { emitTransportClosed: (why: string) => void }
    ).emitTransportClosed(why);
  });

  mockWs.on("message", (data: string) => {
    (conn as unknown as { onMessage: (json: string) => void }).onMessage(data);
  });

  return conn;
}
