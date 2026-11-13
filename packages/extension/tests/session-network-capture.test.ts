import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NetworkManager } from "../understudy/networkManager.js";
import {
  SessionNetworkCapture,
  type SessionNetworkHandlers,
} from "../understudy/sessionNetworkCapture.js";

class Session implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(event: unknown) => void>>();
  readonly calls: string[] = [];

  constructor(readonly id: string | null = "session") {}

  async send<Result = unknown>(method: string): Promise<Result> {
    this.calls.push(method);
    return {} as Result;
  }

  on<Event>(name: string, handler: (event: Event) => void): void {
    const listeners = this.handlers.get(name) ?? new Set();
    listeners.add(handler as (event: unknown) => void);
    this.handlers.set(name, listeners);
  }

  off<Event>(name: string, handler: (event: Event) => void): void {
    this.handlers.get(name)?.delete(handler as (event: unknown) => void);
  }

  emit(name: string, event: unknown): void {
    for (const listener of this.handlers.get(name) ?? []) listener(event);
  }

  listenerCount(): number {
    return [...this.handlers.values()].reduce((count, listeners) => count + listeners.size, 0);
  }

  async close(): Promise<void> {}
}

function request(requestId = "request", frameId = "frame") {
  return {
    requestId,
    frameId,
    loaderId: "loader",
    type: "Document",
    request: { url: "https://example.test/frame" },
  };
}

function handlers(
  receive: (name: string, event: unknown, receivedAt: number) => void,
): SessionNetworkHandlers {
  return {
    "Network.requestWillBeSent": (event, time) => receive("start", event, time),
    "Network.responseReceived": (event, time) => receive("response", event, time),
    "Network.loadingFinished": (event, time) => receive("finish", event, time),
    "Network.loadingFailed": (event, time) => receive("fail", event, time),
    "Network.requestServedFromCache": (event, time) => receive("cache", event, time),
    "Page.frameStoppedLoading": (event, time) => receive("frame-stopped", event, time),
  };
}

function observer() {
  return {
    onRequestStarted: vi.fn(),
    onRequestFinished: vi.fn(),
    onRequestFailed: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SessionNetworkCapture", () => {
  it("buffers a completed request and preserves payloads and arrival times across attachment", () => {
    vi.useFakeTimers();
    const session = new Session();
    const capture = new SessionNetworkCapture(session);
    const receive = vi.fn();
    const start = request();
    const response = { requestId: "request", response: { url: start.request.url, status: 200 } };
    const finish = { requestId: "request" };

    vi.setSystemTime(10);
    session.emit("Network.requestWillBeSent", start);
    vi.setSystemTime(20);
    session.emit("Network.responseReceived", response);
    vi.setSystemTime(30);
    session.emit("Network.loadingFinished", finish);
    expect(receive).not.toHaveBeenCalled();
    expect(session.calls).toEqual([]); // The capture never enables domains itself.

    vi.setSystemTime(1000);
    capture.attach(handlers(receive));
    expect(receive.mock.calls).toEqual([
      ["start", start, 10],
      ["response", response, 20],
      ["finish", finish, 30],
    ]);
    expect(receive.mock.calls[0]![1]).toBe(start);

    const next = request("next");
    session.emit("Network.requestWillBeSent", next);
    expect(receive).toHaveBeenLastCalledWith("start", next, 1000);
    expect(receive).toHaveBeenCalledTimes(4);
    capture.dispose();
  });

  it("queues live events behind buffered events when delivery reenters the session", () => {
    const session = new Session();
    const capture = new SessionNetworkCapture(session);
    const order: string[] = [];
    session.emit("Network.requestWillBeSent", request());
    session.emit("Network.loadingFinished", { requestId: "request" });

    capture.attach(
      handlers((name) => {
        order.push(name);
        if (name === "start") session.emit("Network.loadingFailed", { requestId: "other" });
      }),
    );
    expect(order).toEqual(["start", "finish", "fail"]);
    capture.dispose();
  });

  it("releases a capture before adoption without removing unrelated session listeners", () => {
    const session = new Session();
    const unrelated = vi.fn();
    session.on("Network.loadingFinished", unrelated);
    const capture = new SessionNetworkCapture(session);
    session.emit("Network.requestWillBeSent", request());
    capture.dispose();
    capture.dispose();

    expect(session.listenerCount()).toBe(1);
    session.emit("Network.loadingFinished", { requestId: "request" });
    expect(unrelated).toHaveBeenCalledOnce();
    expect(() => capture.attach(handlers(vi.fn()))).toThrow("disposed");
  });

  it("stops buffered and live delivery when disposed by its consumer", () => {
    const session = new Session();
    const capture = new SessionNetworkCapture(session);
    const receive = vi.fn(() => capture.dispose());
    session.emit("Network.requestWillBeSent", request());
    session.emit("Network.loadingFinished", { requestId: "request" });

    capture.attach(handlers(receive));
    session.emit("Network.requestWillBeSent", request("later"));
    expect(receive).toHaveBeenCalledOnce();
    expect(session.listenerCount()).toBe(0);
  });

  it("rejects a second consumer without replacing the first or replaying events", () => {
    const session = new Session();
    const capture = new SessionNetworkCapture(session);
    const first = vi.fn();
    const second = vi.fn();
    capture.attach(handlers(first));
    expect(() => capture.attach(handlers(second))).toThrow("already has a consumer");
    session.emit("Network.loadingFinished", { requestId: "request" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    capture.dispose();
  });

  it("removes already-installed listeners if registration fails partway through", () => {
    const session = new Session();
    const register = session.on.bind(session);
    vi.spyOn(session, "on").mockImplementation((name, listener) => {
      if (name === "Network.loadingFailed") throw new Error("session detached");
      register(name, listener);
    });
    expect(() => new SessionNetworkCapture(session)).toThrow("session detached");
    expect(session.listenerCount()).toBe(0);
  });
});

describe("NetworkManager using session capture", () => {
  it.each([
    { name: "completion", event: "Network.loadingFinished", payload: { requestId: "request" } },
    {
      name: "failure",
      event: "Network.loadingFailed",
      payload: { requestId: "request", errorText: "failed" },
    },
    { name: "cache", event: "Network.requestServedFromCache", payload: { requestId: "request" } },
    {
      name: "data URL",
      event: "Network.responseReceived",
      payload: { requestId: "request", response: { url: "data:text/plain,hello" } },
    },
    { name: "frame stop", event: "Page.frameStoppedLoading", payload: { frameId: "frame" } },
  ])("preserves request bookkeeping on $name", ({ name, event, payload }) => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const session = new Session();
    const observed = observer();
    manager.addObserver(observed);
    manager.trackSession(session);
    expect(session.calls).toEqual(["Network.enable", "Page.enable"]);

    vi.setSystemTime(10);
    session.emit("Network.requestWillBeSent", request());
    const started = observed.onRequestStarted.mock.calls[0]![0];
    expect(started).toMatchObject({
      requestKey: "session:request",
      timestamp: 10,
      frameId: "frame",
    });
    expect(manager.requests.size).toBe(1);
    expect(manager.documentRequestsByFrame.size).toBe(1);

    vi.setSystemTime(20);
    session.emit(event, payload);
    const ended = name === "failure" ? observed.onRequestFailed : observed.onRequestFinished;
    expect(ended).toHaveBeenCalledExactlyOnceWith({
      ...started,
      timestamp: name === "frame stop" ? 20 : 10,
    });
    expect(manager.requests.size).toBe(0);
    expect(manager.documentRequestsByFrame.size).toBe(0);
    manager.dispose();
    expect(session.listenerCount()).toBe(0);
  });

  it("keeps sessions isolated and releases listeners on untrack and disposal", () => {
    const manager = new NetworkManager();
    const parent = new Session(null);
    const child = new Session("child");
    const observed = observer();
    manager.addObserver(observed);
    manager.trackSession(parent);
    manager.trackSession(parent);
    manager.trackSession(child);
    expect(parent.calls).toEqual(["Network.enable", "Page.enable"]);
    expect(parent.listenerCount()).toBe(6);

    parent.emit("Network.requestWillBeSent", request("shared", "parent-frame"));
    child.emit("Network.requestWillBeSent", request("shared", "child-frame"));
    expect([...manager.requests.keys()]).toEqual(["__main__:shared", "child:shared"]);
    expect(observed.onRequestStarted).toHaveBeenCalledTimes(2);

    manager.untrackSession(undefined);
    expect(parent.listenerCount()).toBe(0);
    expect([...manager.requests.keys()]).toEqual(["child:shared"]);
    expect([...manager.documentRequestsByFrame.keys()]).toEqual(["child-frame"]);
    parent.emit("Network.loadingFinished", { requestId: "shared" });
    expect(observed.onRequestFinished).not.toHaveBeenCalled();
    child.emit("Network.loadingFinished", { requestId: "shared" });
    expect(observed.onRequestFinished).toHaveBeenCalledOnce();

    manager.dispose();
    manager.dispose();
    expect(child.listenerCount()).toBe(0);
    expect(manager.sessions.size).toBe(0);
    expect(manager.requests.size).toBe(0);
    expect(manager.observers.size).toBe(0);
  });

  it("keeps networkidle pending until a live request completes and the quiet period elapses", async () => {
    vi.useFakeTimers();
    const manager = new NetworkManager();
    const session = new Session();
    manager.trackSession(session);
    const idle = manager.waitForIdle({ timeout: 1000, idleTimeMs: 50 });
    const settled = vi.fn();
    void idle.promise.then(settled);
    session.emit("Network.requestWillBeSent", request());
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    session.emit("Network.loadingFinished", { requestId: "request" });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await idle.promise;
    expect(settled).toHaveBeenCalledOnce();
    manager.dispose();
  });
});
