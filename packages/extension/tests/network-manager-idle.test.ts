import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NetworkManager } from "../understudy/networkManager.js";

type Handler = (params: unknown) => void;

function createSession(): {
  session: CDPSessionLike;
  emit: (event: string, params: unknown) => void;
} {
  const handlers = new Map<string, Set<Handler>>();
  const session = {
    id: "session-1",
    send: vi.fn(async () => ({})),
    on: (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
    },
    off: (event: string, handler: Handler) => handlers.get(event)?.delete(handler),
    close: vi.fn(),
  } as unknown as CDPSessionLike;
  return {
    session,
    emit: (event, params) => {
      for (const handler of handlers.get(event) ?? []) handler(params);
    },
  };
}

describe("NetworkManager.waitForIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a request that started before the waiter was registered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);

    // The request starts after the navigation but before waitForIdle() is called.
    vi.setSystemTime(1_100);
    emit("Network.requestWillBeSent", {
      requestId: "xhr-1",
      loaderId: "loader-1",
      frameId: "main",
      type: "XHR",
      request: { url: "https://example.com/api" },
    });

    vi.setSystemTime(1_200);
    let settled = false;
    const handle = manager.waitForIdle({ startTime: 1_000, timeout: 10_000, idleTimeMs: 500 });
    void handle.promise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);

    emit("Network.loadingFinished", { requestId: "xhr-1" });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("ignores in-flight requests that started before the wait window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);
    emit("Network.requestWillBeSent", {
      requestId: "old",
      loaderId: "loader-0",
      frameId: "main",
      type: "XHR",
      request: { url: "https://example.com/old" },
    });

    vi.setSystemTime(2_000);
    let settled = false;
    const handle = manager.waitForIdle({ startTime: 2_000, timeout: 10_000, idleTimeMs: 500 });
    void handle.promise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(true);
  });
});
