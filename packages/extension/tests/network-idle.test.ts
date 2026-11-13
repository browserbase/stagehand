import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NetworkManager } from "../understudy/networkManager.js";
import { waitForMainNetworkIdle } from "../understudy/networkIdle.js";
import { Page } from "../understudy/page.js";
import { runWithProgress } from "../understudy/progress.js";

type Handler = (params: unknown) => void;

function createPage(initiallyLoaded = true) {
  const handlers = new Map<string, Set<Handler>>();
  const transportListeners = new Set<(reason: string) => void>();
  const lifetime = new AbortController();
  const frame = { lastSeen: { loaderId: "loader-1" } };
  let loaded = initiallyLoaded;
  const session = {
    id: "session-main",
    send: async () => ({}),
    on: (event: string, handler: Handler) => {
      const listeners = handlers.get(event) ?? new Set<Handler>();
      listeners.add(handler);
      handlers.set(event, listeners);
    },
    off: (event: string, handler: Handler) => handlers.get(event)?.delete(handler),
    close: async () => {},
  } as unknown as CDPSessionLike;
  const conn = {
    connected: true,
    onTransportClosed: (handler: (reason: string) => void) => transportListeners.add(handler),
    offTransportClosed: (handler: (reason: string) => void) => transportListeners.delete(handler),
  };
  const manager = new NetworkManager();
  manager.trackSession(session);
  const listenerCount = () => [...handlers.values()].reduce((total, set) => total + set.size, 0);
  const baselineListeners = listenerCount();
  const load = vi.fn((state: LoadState, timeout: number, signal?: AbortSignal) =>
    Page.prototype.waitForMainLoadState.call(page, state, timeout, signal),
  );
  const page = {
    mainSession: session,
    conn,
    closedSignal: lifetime.signal,
    networkManager: manager,
    mainFrameId: () => "frame-main",
    registry: { frames: new Map([["frame-main", frame]]) },
    isMainLoadStateReady: async () => loaded,
    waitForMainLoadState: load,
  } as unknown as Page;
  const emit = (event: string, params: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(params);
  };
  return {
    conn,
    lifetime,
    manager,
    load,
    run: (timeout: number, signal?: AbortSignal) =>
      runWithProgress({ name: "networkidle", timeout }, (progress) =>
        waitForMainNetworkIdle(page, progress, signal),
      ),
    replaceDocument: (loaderId: string, isLoaded = true) => {
      frame.lastSeen.loaderId = loaderId;
      loaded = isLoaded;
      emit("Page.frameNavigated", { frame: { id: "frame-main", loaderId } });
    },
    finishLoad: () => {
      loaded = true;
      emit("Page.lifecycleEvent", {
        frameId: "frame-main",
        loaderId: frame.lastSeen.loaderId,
        name: "load",
        timestamp: 0,
      });
    },
    startRequest: (requestId: string) => {
      emit("Network.requestWillBeSent", {
        requestId,
        loaderId: frame.lastSeen.loaderId,
        frameId: "frame-main",
        type: "Fetch",
        request: { url: "https://example.test/data" },
      });
    },
    finishRequest: (requestId: string) => emit("Network.loadingFinished", { requestId }),
    closeConnection: () => {
      conn.connected = false;
      for (const listener of transportListeners) listener("transport disconnected");
    },
    expectClean: () => {
      expect(listenerCount()).toBe(baselineListeners);
      expect(transportListeners.size).toBe(0);
      expect(manager.observers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      manager.dispose();
    },
  };
}

describe("waitForMainNetworkIdle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects a closed transport without starting a load wait", async () => {
    const fixture = createPage();
    fixture.conn.connected = false;

    await expect(fixture.run(1_000)).rejects.toThrow("CDP connection closed");
    expect(fixture.load).not.toHaveBeenCalled();
    fixture.expectClean();
  });

  it.each([false, true])(
    "cancels and cleans up on transport closure with loaded=%s",
    async (loaded) => {
      const fixture = createPage(loaded);
      const result = fixture.run(2_000);
      const rejected = expect(result).rejects.toThrow(
        "CDP connection closed: transport disconnected",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.load).toHaveBeenCalledOnce();
      expect(fixture.manager.observers.size).toBe(loaded ? 1 : 0);

      fixture.closeConnection();
      await rejected;
      expect(fixture.load.mock.calls[0]![2]!.aborted).toBe(true);
      fixture.expectClean();
    },
  );

  it("cancels the old load wait and counts the replacement document's requests", async () => {
    const fixture = createPage(false);
    let settled = false;
    const result = fixture.run(3_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    const oldLoadSignal = fixture.load.mock.calls[0]![2]!;

    fixture.replaceDocument("loader-2", false);
    fixture.startRequest("destination-fetch");
    await vi.advanceTimersByTimeAsync(0);
    expect(oldLoadSignal.aborted).toBe(true);
    expect(fixture.load).toHaveBeenCalledTimes(2);
    expect(fixture.load.mock.calls[1]![2]!.aborted).toBe(false);
    fixture.finishLoad();

    await vi.advanceTimersByTimeAsync(600);
    expect(settled).toBe(false);
    expect(fixture.manager.observers.size).toBe(1);
    fixture.finishRequest("destination-fetch");
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    fixture.expectClean();
  });

  it("keeps the original deadline through repeated document replacements", async () => {
    const fixture = createPage();
    const result = fixture.run(900);
    const rejected = expect(result).rejects.toMatchObject({
      name: "TimeoutError",
      message: "networkidle timed out after 900ms",
    });
    await vi.advanceTimersByTimeAsync(300);
    fixture.replaceDocument("loader-2");
    await vi.advanceTimersByTimeAsync(300);
    fixture.replaceDocument("loader-3");
    await vi.advanceTimersByTimeAsync(299);
    expect(fixture.manager.observers.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fixture.load).toHaveBeenCalledTimes(3);
    fixture.expectClean();
  });

  it("propagates caller cancellation while the document is loading", async () => {
    const fixture = createPage(false);
    const caller = new AbortController();
    const reason = new Error("Navigation superseded");
    const result = fixture.run(2_000, caller.signal);
    const rejected = expect(result).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);

    caller.abort(reason);
    await rejected;
    expect(fixture.load.mock.calls[0]![2]!.aborted).toBe(true);
    fixture.expectClean();
  });

  it("propagates page closure while the quiet window is running", async () => {
    const fixture = createPage();
    const reason = new Error("Page is disposed");
    const result = fixture.run(2_000);
    const rejected = expect(result).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.manager.observers.size).toBe(1);

    fixture.lifetime.abort(reason);
    await rejected;
    fixture.expectClean();
  });
});
