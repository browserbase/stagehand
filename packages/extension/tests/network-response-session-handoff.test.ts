import { afterEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NetworkManager } from "../understudy/networkManager.js";
import type { Page } from "../understudy/page.js";
import type { Response } from "../understudy/response.js";
import { SessionNetworkCapture } from "../understudy/sessionNetworkCapture.js";

class Session implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(event: unknown) => void>>();
  readonly calls: Array<{ method: string; params?: object }> = [];
  constructor(readonly id: string) {}
  async send<T = unknown>(method: string, params?: object): Promise<T> {
    this.calls.push({ method, params });
    return (
      method === "Network.getResponseBody"
        ? { body: `body from ${this.id}`, base64Encoded: false }
        : {}
    ) as T;
  }
  on<T>(name: string, handler: (event: T) => void): void {
    const handlers = this.handlers.get(name) ?? new Set();
    handlers.add(handler as (event: unknown) => void);
    this.handlers.set(name, handlers);
  }
  off<T>(name: string, handler: (event: T) => void): void {
    this.handlers.get(name)?.delete(handler as (event: unknown) => void);
  }
  emit(name: string, event: unknown): void {
    for (const handler of this.handlers.get(name) ?? []) handler(event);
  }
  listenerCount(): number {
    return [...this.handlers.values()].reduce((count, handlers) => count + handlers.size, 0);
  }
  async close(): Promise<void> {}
}

const managers: NetworkManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  vi.useRealTimers();
});

function setup() {
  const parent = new Session("parent");
  const child = new Session("child");
  const manager = new NetworkManager({} as Page);
  managers.push(manager);
  manager.trackSession(parent);
  const responses: Response[] = [];
  const started = vi.fn();
  const finished = vi.fn();
  const failed = vi.fn();
  manager.addObserver({
    onRequestStarted: started,
    onRequestFinished: finished,
    onRequestFailed: failed,
    onResponse: (response) => responses.push(response),
  });
  return { parent, child, manager, responses, started, finished, failed };
}

function start(
  session: Session,
  options: {
    requestId?: string;
    loaderId?: string;
    frameId?: string;
    type?: Protocol.Network.ResourceType;
    headers?: boolean;
  } = {},
) {
  const requestId = options.requestId ?? "document";
  const frameId = options.frameId ?? "child-frame";
  const loaderId = options.loaderId ?? requestId;
  const type = options.type ?? "Document";
  const url = `https://example.test/${requestId}`;
  session.emit("Network.requestWillBeSent", {
    requestId,
    frameId,
    loaderId,
    type,
    request: { url },
  });
  if (options.headers !== false)
    session.emit("Network.responseReceived", {
      requestId,
      frameId,
      loaderId,
      type,
      response: { url, status: 200, headers: {} },
    });
}

function complete(session: Session, failed = false, requestId = "document") {
  session.emit(failed ? "Network.loadingFailed" : "Network.loadingFinished", {
    requestId,
    errorText: "net::ERR_FAILED",
  });
}

const transfers = [
  { buffered: false, failure: false },
  { buffered: true, failure: false },
  { buffered: false, failure: true },
  { buffered: true, failure: true },
];

describe("iframe document response session handoff", () => {
  it.each(transfers)(
    "handles completion on the child (buffered: $buffered, failure: $failure)",
    async ({ buffered, failure }) => {
      vi.useFakeTimers();
      const { parent, child, manager, responses, started, finished, failed } = setup();
      const idle = manager.waitForIdle({ timeout: 1000, idleTimeMs: 20 });
      start(parent);
      const response = responses[0]!;
      expect(response.session).toBe(parent);
      const body = response.text();
      // Attach rejection handling before the failure event.
      const checkedBody = failure
        ? expect(body).rejects.toThrow("net::ERR_FAILED")
        : expect(body).resolves.toBe("body from child");
      await Promise.resolve();
      expect(parent.calls.some((call) => call.method === "Network.getResponseBody")).toBe(false);

      if (buffered) {
        const capture = new SessionNetworkCapture(child);
        complete(child, failure);
        manager.trackSession(child, capture, "child-frame");
      } else {
        manager.trackSession(child, undefined, "child-frame");
        complete(child, failure);
      }
      expect(response.finishedSettled).toBe(true);
      expect(response.session).toBe(child);
      // Detaching the old owner must not invalidate a body read queued by completion.
      manager.untrackSession(parent.id);
      await checkedBody;
      if (failure)
        await expect(response.finished()).resolves.toMatchObject({ message: "net::ERR_FAILED" });
      else await expect(response.finished()).resolves.toBeNull();
      expect(responses).toEqual([response]);
      expect(failure ? failed : finished).toHaveBeenCalledExactlyOnceWith(
        started.mock.calls[0]![0],
      );
      expect(manager.requests.size).toBe(0);
      expect(manager.documentRequestsByFrame.size).toBe(0);
      expect(parent.calls.some((call) => call.method === "Network.getResponseBody")).toBe(false);
      expect(child.calls.filter((call) => call.method === "Network.getResponseBody")).toEqual(
        failure ? [] : [{ method: "Network.getResponseBody", params: { requestId: "document" } }],
      );
      await vi.advanceTimersByTimeAsync(20);
      await idle.promise;
      manager.dispose();
      expect(parent.listenerCount()).toBe(0);
      expect(child.listenerCount()).toBe(0);
    },
  );

  it.each([false, true])(
    "handles a child's completion replaying before parent headers (failure: %s)",
    async (failure) => {
      const { parent, child, manager, responses, started, finished, failed } = setup();
      manager.untrackSession(parent.id);
      const parentCapture = new SessionNetworkCapture(parent);
      const childCapture = new SessionNetworkCapture(child);
      start(parent);
      complete(child, failure);
      manager.trackSession(child, childCapture, "child-frame");
      manager.trackSession(parent, parentCapture);
      expect(responses).toHaveLength(1);
      expect(responses[0]!.finishedSettled).toBe(true);
      expect(responses[0]!.session).toBe(child);
      if (failure) await expect(responses[0]!.text()).rejects.toThrow("net::ERR_FAILED");
      else await expect(responses[0]!.text()).resolves.toBe("body from child");
      expect(failure ? failed : finished).toHaveBeenCalledWith(started.mock.calls[0]![0]);
      expect(manager.requests.size).toBe(0);
      expect(manager.documentRequestsByFrame.size).toBe(0);
    },
  );

  it("discards unmatched completion when the child detaches", () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    complete(child);
    manager.untrackSession(child.id);
    start(parent);
    expect(responses[0]!.finishedSettled).toBe(false);
  });

  it.each([{ type: "Fetch" as const }, { loaderId: "other-loader" }, { frameId: "sibling-frame" }])(
    "does not transfer unrelated requests: %j",
    async (options) => {
      const { parent, child, manager, responses } = setup();
      manager.trackSession(child, undefined, "child-frame");
      start(parent, options);
      const response = responses[0]!;
      complete(child);
      expect(response.finishedSettled).toBe(false);
      expect(response.session).toBe(parent);
      expect(manager.requests.has("parent:document")).toBe(true);
      complete(parent);
      await expect(response.text()).resolves.toBe("body from parent");
    },
  );

  it("prefers a request on the completing session when another session uses the same ID", async () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    start(child, { type: "Fetch" });
    complete(child);
    expect(responses[0]!.finishedSettled).toBe(false);
    expect(responses[0]!.session).toBe(parent);
    await expect(responses[1]!.text()).resolves.toBe("body from child");
    expect(manager.requests.has("parent:document")).toBe(true);
    complete(parent);
    await expect(responses[0]!.text()).resolves.toBe("body from parent");
  });

  it("does not claim a document response when a local request fails before headers", () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    start(child, { type: "Fetch", headers: false });
    complete(child, true);
    expect(responses[0]!.finishedSettled).toBe(false);
    expect(responses[0]!.session).toBe(parent);
    expect(manager.requests.has("parent:document")).toBe(true);
  });

  it("does not retain a cached local request's completion as a document handoff", () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(child, { type: "Fetch", headers: false });
    child.emit("Network.requestServedFromCache", { requestId: "document" });
    complete(child);
    start(parent);
    expect(responses[0]!.finishedSettled).toBe(false);
    expect(responses[0]!.session).toBe(parent);
  });

  it("does not transfer to the main session or an unassociated session", () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child);
    start(parent);
    complete(child);
    expect(responses[0]!.finishedSettled).toBe(false);
    start(child, { requestId: "other", frameId: "parent-frame" });
    complete(parent, false, "other");
    expect(responses[1]!.finishedSettled).toBe(false);
  });

  it("cleans up parent bookkeeping even without a response subscriber", () => {
    const { parent, child, manager, responses } = setup();
    manager.observers.clear();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    complete(child);
    expect(responses).toEqual([]);
    expect(manager.requests.size).toBe(0);
    expect(manager.documentRequestsByFrame.size).toBe(0);
  });

  it("preserves the document lookup when a subresource in the same frame finishes", () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    start(parent, { requestId: "fetch", type: "Fetch" });
    complete(parent, false, "fetch");
    expect(manager.documentRequestsByFrame.get("child-frame")).toBe("parent:document");
    complete(child);
    expect(responses[0]!.finishedSettled).toBe(true);
    expect(manager.requests.size).toBe(0);
  });

  it("transfers the response even after frameStoppedLoading retired its bookkeeping", async () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    parent.emit("Page.frameStoppedLoading", { frameId: "child-frame" });
    expect(manager.requests.size).toBe(0);
    complete(child);
    await expect(responses[0]!.text()).resolves.toBe("body from child");
  });

  it("settles a parent-bound document if its child detaches before completion", async () => {
    const { parent, child, manager, responses } = setup();
    manager.trackSession(child, undefined, "child-frame");
    start(parent);
    start(parent, { requestId: "sibling", frameId: "sibling-frame" });
    const body = expect(responses[0]!.text()).rejects.toThrow("detached");
    manager.untrackSession(child.id);
    await body;
    expect(responses[1]!.finishedSettled).toBe(false);
    expect([...manager.requests.keys()]).toEqual(["parent:sibling"]);
    expect([...manager.documentRequestsByFrame.keys()]).toEqual(["sibling-frame"]);
    expect(child.listenerCount()).toBe(0);
    complete(parent, false, "sibling");
    await expect(responses[1]!.text()).resolves.toBe("body from parent");
  });

  it("moves response listeners and ignores old-session events after a handoff", async () => {
    const { parent, child, manager, responses } = setup();
    start(parent);
    const response = responses[0]!;
    response.updateSession(child);
    response.updateSession(child);
    expect(child.listenerCount()).toBe(3);
    manager.untrackSession(parent.id);
    complete(parent);
    expect(response.finishedSettled).toBe(false);
    complete(child);
    await expect(response.text()).resolves.toBe("body from child");
    expect(child.listenerCount()).toBe(0);
    response.updateSession(parent);
    expect(response.session).toBe(child);
  });
});
