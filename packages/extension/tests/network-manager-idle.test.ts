import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NetworkManager } from "../understudy/networkManager.js";
import { mainDocumentIdleFilter } from "../understudy/networkIdle.js";
import { TimeoutError } from "../errors.js";

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

  it("drops requests of a document that its frame navigated away from", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);
    emit("Network.requestWillBeSent", {
      requestId: "xhr-1",
      loaderId: "loader-1",
      frameId: "main",
      type: "XHR",
      request: { url: "https://example.com/api" },
    });

    let settled = false;
    const handle = manager.waitForIdle({ startTime: 0, timeout: 10_000, idleTimeMs: 500 });
    void handle.promise.then(() => {
      settled = true;
    });

    emit("Page.frameNavigated", { frame: { id: "main", loaderId: "loader-2" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(true);
    expect(manager.requests.size).toBe(0);
  });

  it("restarts the full quiet window when a request arrives", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);
    const handle = manager.waitForIdle({ timeout: 5_000, idleTimeMs: 500 });
    const resolved = vi.fn();
    void handle.promise.then(resolved);

    await vi.advanceTimersByTimeAsync(400);
    emit("Network.requestWillBeSent", {
      requestId: "late",
      loaderId: "loader-1",
      frameId: "main",
      type: "Fetch",
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(resolved).not.toHaveBeenCalled();

    emit("Network.loadingFailed", { requestId: "late" });
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await handle.promise;
    expect(resolved).toHaveBeenCalledOnce();
    expect(manager.observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])(
    "rejects when the %ims deadline leaves no complete quiet window",
    async (timeout) => {
      vi.useFakeTimers();
      const manager = new NetworkManager();
      const handle = manager.waitForIdle({ timeout, totalBudgetMs: 1_000, idleTimeMs: 500 });
      const rejected = expect(handle.promise).rejects.toEqual(
        new TimeoutError("networkidle", 1_000),
      );

      await vi.advanceTimersByTimeAsync(timeout);
      await rejected;
      expect(manager.observers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([new Error("caller canceled"), false, null])(
    "rejects an already-aborted wait with reason %s without leaving observers or timers",
    async (reason) => {
      vi.useFakeTimers();
      const manager = new NetworkManager();
      const { session, emit } = createSession();
      manager.trackSession(session);
      emit("Network.requestWillBeSent", {
        requestId: "pending",
        loaderId: "loader-1",
        frameId: "main",
        type: "Fetch",
      });
      const signal = AbortSignal.abort(reason);
      const handle = manager.waitForIdle({ startTime: 0, timeout: 5_000, signal });

      await expect(handle.promise).rejects.toBe(reason);
      expect(manager.observers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancels a seeded request wait and releases its abort listener", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);
    emit("Network.requestWillBeSent", {
      requestId: "pending",
      loaderId: "loader-1",
      frameId: "main",
      type: "Fetch",
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const handle = manager.waitForIdle({
      startTime: 0,
      timeout: Infinity,
      signal: controller.signal,
    });
    const reason = new Error("page closed");
    const rejected = expect(handle.promise).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.observers.size).toBe(1);

    controller.abort(reason);
    await rejected;
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(manager.observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    emit("Network.loadingFinished", { requestId: "pending" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels during the quiet window and clears both timers", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const controller = new AbortController();
    const handle = manager.waitForIdle({ timeout: 5_000, signal: controller.signal });
    const reason = new Error("navigation replaced");
    const rejected = expect(handle.promise).rejects.toBe(reason);

    await vi.advanceTimersByTimeAsync(499);
    controller.abort(reason);
    await rejected;
    expect(manager.observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("filters seeded and later traffic to the current main document", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const { session, emit } = createSession();
    manager.trackSession(session);
    for (const request of [
      { requestId: "current", loaderId: "current-loader", frameId: "main", type: "Fetch" },
      { requestId: "previous", loaderId: "previous-loader", frameId: "main", type: "Fetch" },
      { requestId: "child", loaderId: "child-loader", frameId: "child", type: "Fetch" },
      { requestId: "worker", loaderId: "", frameId: "main", type: "Script" },
      { requestId: "unknown", frameId: "main", type: "Fetch" },
      { requestId: "events", loaderId: "current-loader", frameId: "main", type: "EventSource" },
      { requestId: "socket", loaderId: "current-loader", frameId: "main", type: "WebSocket" },
    ]) {
      emit("Network.requestWillBeSent", request);
    }
    const handle = manager.waitForIdle({
      startTime: 0,
      timeout: Infinity,
      filter: mainDocumentIdleFilter("current-loader", "main"),
    });
    const resolved = vi.fn();
    void handle.promise.then(resolved);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).not.toHaveBeenCalled();
    emit("Network.loadingFinished", { requestId: "current" });
    await vi.advanceTimersByTimeAsync(400);
    emit("Network.requestWillBeSent", {
      requestId: "later-worker",
      loaderId: "",
      frameId: "main",
      type: "Script",
    });
    await vi.advanceTimersByTimeAsync(100);
    await handle.promise;
    expect(resolved).toHaveBeenCalledOnce();
    expect(manager.observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
