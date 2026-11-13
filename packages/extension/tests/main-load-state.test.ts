import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

const LOAD_EVENTS = ["Page.lifecycleEvent", "Page.domContentEventFired", "Page.loadEventFired"];

type Handler = (params: unknown) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createPage() {
  const handlers = new Map<string, Set<Handler>>();
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));
  const session = {
    id: "session-main",
    send,
    on(event: string, handler: Handler) {
      const listeners = handlers.get(event) ?? new Set<Handler>();
      listeners.add(handler);
      handlers.set(event, listeners);
    },
    off(event: string, handler: Handler) {
      handlers.get(event)?.delete(handler);
    },
    close: async () => {},
  } as unknown as CDPSessionLike;
  const ready = vi.fn(async () => false);
  const frame = { lastSeen: { loaderId: "loader-current" } };
  const page = Object.assign(Object.create(Page.prototype), {
    mainSession: session,
    mainFrameId: () => "frame-main",
    registry: { frames: new Map([["frame-main", frame]]) },
    isMainLoadStateReady: ready,
  }) as Page;
  return {
    page,
    send,
    ready,
    frame,
    emit: (event: string, params: unknown) => {
      for (const handler of handlers.get(event) ?? []) handler(params);
    },
    listenerCount: () => {
      return LOAD_EVENTS.reduce((total, event) => total + (handlers.get(event)?.size ?? 0), 0);
    },
  };
}

function lifecycle(loaderId: string) {
  return { frameId: "frame-main", loaderId, name: "load", timestamp: 0 };
}

describe("Page.waitForMainLoadState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bounds lifecycle setup and prevents late setup from installing more work", async () => {
    const { page, send, ready, listenerCount } = createPage();
    const setup = deferred<unknown>();
    send.mockReturnValue(setup.promise);
    const result = page.waitForMainLoadState("load", 50);
    const rejected = expect(result).rejects.toThrow("timed out after 50ms");

    expect(listenerCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    setup.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled readyState check and ignores its late result", async () => {
    const { page, ready, listenerCount } = createPage();
    const evaluation = deferred<boolean>();
    ready.mockReturnValue(evaluation.promise);
    const result = page.waitForMainLoadState("load", 50);
    const rejected = expect(result).rejects.toThrow("timed out after 50ms");

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(ready).toHaveBeenCalledOnce();
    expect(listenerCount()).toBe(0);

    evaluation.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels stalled setup and removes the signal listener", async () => {
    const { page, send, ready, listenerCount } = createPage();
    const setup = deferred<unknown>();
    send.mockReturnValue(setup.promise);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("Main document changed");
    const result = page.waitForMainLoadState("load", 1_000, controller.signal);
    const rejected = expect(result).rejects.toBe(reason);

    controller.abort(reason);
    await rejected;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    setup.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
  });

  it("cancels both the deadline and the next readyState poll", async () => {
    const { page, ready, listenerCount } = createPage();
    const controller = new AbortController();
    const reason = new Error("Page closed");
    const result = page.waitForMainLoadState("load", 1_000, controller.signal);
    const rejected = expect(result).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(2);

    controller.abort(reason);
    await rejected;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toHaveBeenCalledOnce();
  });

  it("observes a lifecycle event delivered before setup acknowledges", async () => {
    const { page, send, ready, emit, listenerCount } = createPage();
    send.mockImplementation(async () => {
      emit("Page.lifecycleEvent", lifecycle("loader-current"));
      return {};
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await expect(
      page.waitForMainLoadState("load", 1_000, controller.signal),
    ).resolves.toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("ignores lifecycle events from a replaced main document", async () => {
    const { page, emit, listenerCount } = createPage();
    let settled = false;
    const result = page.waitForMainLoadState("load", 1_000).then(() => {
      settled = true;
    });
    emit("Page.lifecycleEvent", lifecycle("loader-old"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    emit("Page.lifecycleEvent", lifecycle("loader-current"));
    await result;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a readyState result from a replaced document", async () => {
    const { page, ready, frame, emit } = createPage();
    const evaluation = deferred<boolean>();
    ready.mockReturnValueOnce(evaluation.promise);
    let settled = false;
    const result = page.waitForMainLoadState("load", 1_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    frame.lastSeen.loaderId = "loader-new";
    evaluation.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    emit("Page.lifecycleEvent", lifecycle("loader-new"));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls live readyState when the lifecycle event was missed", async () => {
    const { page, ready, listenerCount } = createPage();
    ready.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = page.waitForMainLoadState("domcontentloaded", 1_000);
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBeUndefined();
    expect(ready).toHaveBeenCalledTimes(2);
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a load event at the deadline even before the timeout callback runs", async () => {
    const { page, emit, listenerCount } = createPage();
    setTimeout(() => emit("Page.lifecycleEvent", lifecycle("loader-current")), 50);
    const result = page.waitForMainLoadState("load", 50);
    const rejected = expect(result).rejects.toThrow("timed out after 50ms");

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an exhausted budget before sending a CDP command", async () => {
    const { page, send, listenerCount } = createPage();
    await expect(page.waitForMainLoadState("load", 0)).rejects.toThrow("timed out after 0ms");
    expect(send).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an already canceled wait before sending a CDP command", async () => {
    const { page, send, listenerCount } = createPage();
    const controller = new AbortController();
    const reason = new Error("Page closed");
    controller.abort(reason);

    await expect(page.waitForMainLoadState("load", 1_000, controller.signal)).rejects.toBe(reason);
    expect(send).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
