import { describe, expect, it, vi } from "vitest";
import type { PageCDPEvent } from "../../protocol/types.js";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

class FakeCDPSession implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  readonly sendCalls: Array<{ method: string; params?: object }> = [];
  readonly responseBodies = new Map<string, { body: string; base64Encoded: boolean }>();

  constructor(readonly id: string) {}

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.sendCalls.push({ method, params });
    if (method === "Network.getResponseBody") {
      const requestId = (params as { requestId?: string } | undefined)?.requestId ?? "";
      return (this.responseBodies.get(requestId) ?? {}) as Result;
    }
    return {} as Result;
  }

  on<Params = unknown>(event: string, handler: (params: Params) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<Params = unknown>(event: string, handler: (params: Params) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {}

  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function createPage(
  mainSession: FakeCDPSession,
  logger: StagehandLogger = {} as StagehandLogger,
): Page {
  const connection = {
    targetIdForSession: (sessionId: string) => `target-${sessionId}`,
  } as CdpConnection;
  return new Page(connection, mainSession, "target-main", "frame-main", logger);
}

describe("Page CDP event subscriptions", () => {
  it("covers the main session plus current and future OOPIF sessions", async () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);
    const events: unknown[] = [];

    const unsubscribe = await page.subscribeCDPEvent("console", (event) => {
      events.push(event);
    });
    main.emit("Runtime.consoleAPICalled", { type: "log", args: [] });
    page.adoptOopifSession(child, "frame-child");
    child.emit("Runtime.consoleAPICalled", { type: "warning", args: [] });

    expect(events).toStrictEqual([
      {
        pageId: "target-main",
        method: "Runtime.consoleAPICalled",
        params: { type: "log", args: [] },
        sessionId: "main",
        targetId: "target-main",
      },
      {
        pageId: "target-main",
        method: "Runtime.consoleAPICalled",
        params: { type: "warning", args: [] },
        sessionId: "child",
        targetId: "target-child",
      },
    ]);

    page.detachOopifSession("child");
    expect(child.listenerCount("Runtime.consoleAPICalled")).toBe(0);
    unsubscribe();
    expect(main.listenerCount("Runtime.consoleAPICalled")).toBe(0);
  });

  it("removes every raw listener when the page is disposed", async () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);

    page.adoptOopifSession(child, "frame-child");
    await page.subscribeCDPEvent("console", () => {});
    page.dispose();

    expect(main.listenerCount("Runtime.consoleAPICalled")).toBe(0);
    expect(child.listenerCount("Runtime.consoleAPICalled")).toBe(0);
  });

  it("isolates listener failures so other subscriptions still receive the event", async () => {
    const main = new FakeCDPSession("main");
    const logError = vi.fn();
    const page = createPage(main, { error: logError } as unknown as StagehandLogger);
    const events: PageCDPEvent[] = [];

    await page.subscribeCDPEvent("console", () => {
      throw new Error("listener failed");
    });
    await page.subscribeCDPEvent("console", (event) => events.push(event));

    expect(() => main.emit("Runtime.consoleAPICalled", { type: "log", args: [] })).not.toThrow();
    expect(events).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(
      "Page CDP event listener failed",
      expect.objectContaining({
        category: "page",
        method: "Runtime.consoleAPICalled",
        sessionId: "main",
        error: "listener failed",
      }),
    );
  });

  it("emits typed network captures with response bodies across page sessions", async () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    main.responseBodies.set("request-1", { body: '{"ok":true}', base64Encoded: false });
    const page = createPage(main);
    page.adoptOopifSession(child, "frame-child");
    const events: PageCDPEvent[] = [];

    const unsubscribe = await page.subscribeCDPEvent("network", (event) => events.push(event));
    main.emit("Network.requestWillBeSent", {
      requestId: "request-1",
      request: {
        url: "https://example.test/api",
        method: "POST",
        headers: { "Content-Type": "application/json", attempts: 2 },
        postData: '{"ready":true}',
      },
      type: "Fetch",
    });
    main.emit("Network.responseReceived", {
      requestId: "request-1",
      response: {
        url: "https://example.test/api",
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
        mimeType: "application/json",
      },
    });
    main.emit("Network.loadingFinished", { requestId: "request-1" });
    child.emit("Network.requestWillBeSent", {
      requestId: "request-1",
      request: { url: "https://child.example.test/", method: "GET", headers: {} },
      type: "Document",
    });
    child.emit("Network.loadingFailed", {
      requestId: "request-1",
      errorText: "net::ERR_FAILED",
    });

    await vi.waitFor(() => expect(events).toHaveLength(4));
    expect(events[0]).toMatchObject({
      method: "Network.requestWillBeSent",
      sessionId: "main",
      targetId: "target-main",
      params: {
        requestKey: "main:request-1",
        requestId: "request-1",
        httpMethod: "POST",
        headers: { "Content-Type": "application/json", attempts: "2" },
        body: '{"ready":true}',
      },
    });
    expect(events[1]).toMatchObject({
      method: "Network.requestWillBeSent",
      sessionId: "child",
      targetId: "target-child",
      params: { requestKey: "child:request-1" },
    });
    expect(events[2]).toMatchObject({
      method: "Network.loadingFailed",
      sessionId: "child",
      params: { requestKey: "child:request-1", errorText: "net::ERR_FAILED" },
    });
    expect(events[3]).toMatchObject({
      method: "Network.loadingFinished",
      sessionId: "main",
      params: {
        requestKey: "main:request-1",
        status: 200,
        body: '{"ok":true}',
        base64Encoded: false,
      },
    });

    unsubscribe();
    expect(main.sendCalls.some((call) => call.method === "Network.disable")).toBe(false);
  });
});
