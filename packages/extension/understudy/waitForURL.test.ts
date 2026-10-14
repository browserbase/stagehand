import { trace } from "@opentelemetry/api";
import type { Protocol } from "devtools-protocol";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";
import { urlMatcher } from "./waitForURL.js";

class Session implements CDPSessionLike {
  readonly id = "session";
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  async send<T>(): Promise<T> {
    return {} as T;
  }
  async close(): Promise<void> {}
  on<T>(event: string, handler: (params: T) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }
  off<T>(event: string, handler: (params: T) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }
  emit<T>(event: string, params: T): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }
  listeners(): number {
    return [...this.handlers.values()].reduce((count, handlers) => count + handlers.size, 0);
  }
}

describe("URL glob matching", () => {
  it.each([
    ["https://example.test/a?x=(1)#hash", "https://example.test/a?x=(1)#hash", true],
    ["https://example.test/a", "https://example.test/ab", false],
    ["https://example.test/*", "https://example.test/a/b", false],
    ["https://example.test/*", "https://example.test/a", true],
    ["**/a/**", "https://example.test/a/b/c", true],
    ["https://example.test/{a,b}", "https://example.test/a", false],
  ])("matches %s against %s: %s", (pattern, url, expected) => {
    expect(urlMatcher(pattern)(url)).toBe(expected);
  });
});

describe("Page.waitForURL", () => {
  let page: Page;
  let session: Session;
  let baselineListeners: number;
  let ready: MockInstance<Page["isMainLoadStateReady"]>;

  beforeEach(() => {
    vi.useFakeTimers();
    const logger = new StagehandLogger({ tracer: trace.getTracer("url-test") }, () => {});
    const connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      logger,
    );
    session = new Session();
    page = new Page(connection, session, "page", "main", logger);
    page.seedCurrentUrl("https://example.test/start");
    session.on<Protocol.Page.FrameNavigatedEvent>("Page.frameNavigated", ({ frame }) => {
      page.onFrameNavigated(frame, session);
    });
    session.on<Protocol.Page.NavigatedWithinDocumentEvent>(
      "Page.navigatedWithinDocument",
      (event) => {
        page.onNavigatedWithinDocument(event.frameId, event.url, session);
      },
    );
    ready = vi.spyOn(page, "isMainLoadStateReady").mockResolvedValue(true);
    baselineListeners = session.listeners();
  });

  afterEach(() => {
    page.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function sameDocument(url: string, frameId = "main") {
    session.emit("Page.navigatedWithinDocument", { frameId, url });
  }

  it("returns immediately when the current URL and load state match", async () => {
    await page.waitForURL("**/start");
    expect(ready).toHaveBeenCalledWith("load");
    expect(session.listeners()).toBe(baselineListeners);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores child-frame navigation and waits for history/hash changes", async () => {
    const settled = vi.fn();
    const pending = page.waitForURL("**/done#hash").then(settled);
    await vi.advanceTimersByTimeAsync(0);
    sameDocument("https://example.test/done#hash", "child");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    sameDocument("https://example.test/done#hash");
    await pending;
    expect(session.listeners()).toBe(baselineListeners);
  });

  it("includes the fragment of a newly navigated document", async () => {
    const pending = page.waitForURL("**/done#section");
    await vi.advanceTimersByTimeAsync(0);
    session.emit("Page.frameNavigated", {
      frame: {
        id: "main",
        loaderId: "document",
        url: "https://example.test/done",
        urlFragment: "#section",
      },
    });
    await pending;
    expect(page.url()).toBe("https://example.test/done#section");
    await page.waitForURL("**/done#section");
  });

  it("follows a new root frame and waits for its lifecycle state", async () => {
    ready.mockResolvedValue(false);
    const settled = vi.fn();
    const pending = page.waitForURL("**/done", { waitUntil: "domcontentloaded" }).then(settled);
    await vi.advanceTimersByTimeAsync(0);
    session.emit("Page.frameNavigated", {
      frame: {
        id: "new-root",
        loaderId: "loader",
        url: "https://example.test/done",
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    session.emit("Page.lifecycleEvent", { frameId: "child", name: "DOMContentLoaded" });
    expect(settled).not.toHaveBeenCalled();
    session.emit("Page.lifecycleEvent", {
      frameId: "new-root",
      name: "DOMContentLoaded",
      loaderId: "loader",
    });
    await pending;
    expect(session.listeners()).toBe(baselineListeners);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks the URL if another navigation starts while loading", async () => {
    ready.mockResolvedValue(false);
    const settled = vi.fn();
    const pending = page.waitForURL("**/done").then(settled);
    await vi.advanceTimersByTimeAsync(0);
    sameDocument("https://example.test/done");
    await vi.advanceTimersByTimeAsync(0);
    sameDocument("https://example.test/elsewhere");
    session.emit("Page.lifecycleEvent", { frameId: "main", name: "load" });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    ready.mockResolvedValue(true);
    sameDocument("https://example.test/done");
    await pending;
  });

  it("does not use the previous document's readiness after a same-URL reload", async () => {
    const settled = vi.fn();
    ready
      .mockImplementationOnce(async () => {
        session.emit("Page.frameNavigated", {
          frame: {
            id: "main",
            loaderId: "reloaded",
            url: "https://example.test/start",
          },
        });
        return true;
      })
      .mockResolvedValue(false);
    const pending = page.waitForURL("**/start").then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    session.emit("Page.lifecycleEvent", { frameId: "main", name: "load", loaderId: "reloaded" });
    await pending;
    expect(ready).toHaveBeenCalledTimes(3);
  });

  it("ignores lifecycle events from the previous document", async () => {
    session.emit("Page.frameNavigated", {
      frame: {
        id: "main",
        loaderId: "current",
        url: "https://example.test/start",
      },
    });
    ready.mockResolvedValue(false);
    const settled = vi.fn();
    const pending = page.waitForURL("**/start").then(settled);
    await vi.advanceTimersByTimeAsync(0);
    session.emit("Page.lifecycleEvent", { frameId: "main", loaderId: "old", name: "load" });
    session.emit("Page.loadEventFired", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    session.emit("Page.lifecycleEvent", { frameId: "main", loaderId: "current", name: "load" });
    await pending;
  });

  it.each([false, true])("cleans up at the deadline (loading: %s)", async (loading) => {
    ready.mockResolvedValue(false);
    const pending = page.waitForURL(loading ? "**/start" : "**/missing", { timeout: 50 });
    const rejected = expect(pending).rejects.toThrow("waitForURL timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(session.listeners()).toBe(baselineListeners);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one timeout budget for matching and loading", async () => {
    ready.mockResolvedValue(false);
    const pending = page.waitForURL("**/done", { timeout: 50 });
    const rejected = expect(pending).rejects.toThrow("waitForURL timed out after 50ms");
    await vi.advanceTimersByTimeAsync(40);
    sameDocument("https://example.test/done");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(session.listeners()).toBe(baselineListeners);
  });

  it("does not install a deadline when timeout is zero", async () => {
    const pending = page.waitForURL("**/done", { timeout: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    sameDocument("https://example.test/done");
    await pending;
  });

  it.each(["page", "transport"])("rejects an unbounded wait when the %s closes", async (target) => {
    const pending = page.waitForURL("**/missing", { timeout: 0 });
    const rejected = expect(pending).rejects.toThrow("Page closed while waiting for URL");
    await vi.advanceTimersByTimeAsync(0);
    if (target === "page") page.dispose();
    else page.conn.emitTransportClosed("closed");
    await rejected;
    expect(session.handlers.get("Page.frameNavigated")?.size).toBe(1);
    expect(session.handlers.get("Page.navigatedWithinDocument")?.size).toBe(1);
    expect(page.conn.transportCloseHandlers.size).toBe(0);
  });

  it("rejects immediately after page disposal", async () => {
    page.dispose();
    await expect(page.waitForURL("**", { timeout: 0 })).rejects.toThrow("Page closed");
  });

  it("rejects immediately when the transport was already disconnected", async () => {
    vi.spyOn(page.conn, "connected", "get").mockReturnValue(false);
    await expect(page.waitForURL("**/missing", { timeout: 0 })).rejects.toThrow("Page closed");
    expect(page.conn.transportCloseHandlers.size).toBe(0);
  });

  it("stops during a stalled readiness check without installing late listeners", async () => {
    let release!: (ready: boolean) => void;
    ready.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const pending = page.waitForURL("**/start", { timeout: 0 });
    const rejected = expect(pending).rejects.toThrow("Page closed");
    await vi.advanceTimersByTimeAsync(0);
    page.dispose();
    await rejected;
    const listenersAfterClose = session.listeners();
    release(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.listeners()).toBe(listenersAfterClose);
    expect(vi.getTimerCount()).toBe(0);
  });
});
