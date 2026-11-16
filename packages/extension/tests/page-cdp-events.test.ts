import { describe, expect, it, vi } from "vitest";
import type { PageCDPEvent } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

class FakeCDPSession implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(readonly id: string) {}

  async send<Result = unknown>(): Promise<Result> {
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

  describe("pageerror", () => {
    const exceptionParams = (description: string) => ({
      timestamp: 1700000000000,
      exceptionDetails: {
        exceptionId: 1,
        text: "Uncaught",
        lineNumber: 0,
        columnNumber: 7,
        url: "http://127.0.0.1/app.js",
        exception: { type: "object", subtype: "error", className: "Error", description },
      },
    });

    it("forwards Runtime.exceptionThrown from the main session and adopted OOPIFs", async () => {
      const main = new FakeCDPSession("main");
      const child = new FakeCDPSession("child");
      const page = createPage(main);
      const events: PageCDPEvent[] = [];

      const unsubscribe = await page.subscribeCDPEvent("pageerror", (event) => {
        events.push(event);
      });
      expect(main.listenerCount("Runtime.exceptionThrown")).toBe(1);
      expect(main.listenerCount("Runtime.consoleAPICalled")).toBe(0);

      main.emit("Runtime.exceptionThrown", exceptionParams("Error: main boom"));
      page.adoptOopifSession(child, "frame-child");
      expect(child.listenerCount("Runtime.exceptionThrown")).toBe(1);
      child.emit("Runtime.exceptionThrown", exceptionParams("Error: child boom"));

      expect(events).toStrictEqual([
        {
          pageId: "target-main",
          method: "Runtime.exceptionThrown",
          params: exceptionParams("Error: main boom"),
          sessionId: "main",
          targetId: "target-main",
        },
        {
          pageId: "target-main",
          method: "Runtime.exceptionThrown",
          params: exceptionParams("Error: child boom"),
          sessionId: "child",
          targetId: "target-child",
        },
      ]);

      page.detachOopifSession("child");
      expect(child.listenerCount("Runtime.exceptionThrown")).toBe(0);
      child.emit("Runtime.exceptionThrown", exceptionParams("Error: after detach"));
      expect(events).toHaveLength(2);

      unsubscribe();
      expect(main.listenerCount("Runtime.exceptionThrown")).toBe(0);
      main.emit("Runtime.exceptionThrown", exceptionParams("Error: after unsubscribe"));
      expect(events).toHaveLength(2);
    });

    it("keeps console and pageerror subscriptions independent", async () => {
      const main = new FakeCDPSession("main");
      const page = createPage(main);
      const consoleEvents: PageCDPEvent[] = [];
      const errorEvents: PageCDPEvent[] = [];

      const stopConsole = await page.subscribeCDPEvent("console", (event) =>
        consoleEvents.push(event),
      );
      const stopErrors = await page.subscribeCDPEvent("pageerror", (event) =>
        errorEvents.push(event),
      );
      main.emit("Runtime.consoleAPICalled", { type: "error", args: [] });
      main.emit("Runtime.exceptionThrown", exceptionParams("Error: boom"));

      expect(consoleEvents.map((event) => event.method)).toStrictEqual([
        "Runtime.consoleAPICalled",
      ]);
      expect(errorEvents.map((event) => event.method)).toStrictEqual(["Runtime.exceptionThrown"]);

      stopErrors();
      expect(main.listenerCount("Runtime.exceptionThrown")).toBe(0);
      expect(main.listenerCount("Runtime.consoleAPICalled")).toBe(1);
      stopConsole();
    });

    it("drops pageerror listeners on every session when the page is disposed", async () => {
      const main = new FakeCDPSession("main");
      const child = new FakeCDPSession("child");
      const page = createPage(main);
      const listener = vi.fn();

      page.adoptOopifSession(child, "frame-child");
      await page.subscribeCDPEvent("pageerror", listener);
      page.dispose();
      main.emit("Runtime.exceptionThrown", exceptionParams("Error: late"));
      child.emit("Runtime.exceptionThrown", exceptionParams("Error: late"));

      expect(listener).not.toHaveBeenCalled();
      expect(main.listenerCount("Runtime.exceptionThrown")).toBe(0);
      expect(child.listenerCount("Runtime.exceptionThrown")).toBe(0);
      await expect(page.subscribeCDPEvent("pageerror", listener)).rejects.toThrow(
        "Page is disposed",
      );
    });
  });
});
