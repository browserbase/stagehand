import { describe, expect, it } from "vitest";
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

function createPage(mainSession: FakeCDPSession): Page {
  const connection = {
    targetIdForSession: (sessionId: string) => `target-${sessionId}`,
  } as CdpConnection;
  return new Page(connection, mainSession, "target-main", "frame-main", {} as StagehandLogger);
}

describe("Page CDP event subscriptions", () => {
  it("covers the main session plus current and future OOPIF sessions", () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);
    const events: unknown[] = [];

    const unsubscribe = page.subscribeCDPEvent("Runtime.consoleAPICalled", (event) => {
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

  it("removes every raw listener when the page is disposed", () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);

    page.adoptOopifSession(child, "frame-child");
    page.subscribeCDPEvent("Network.responseReceived", () => {});
    page.dispose();

    expect(main.listenerCount("Network.responseReceived")).toBe(0);
    expect(child.listenerCount("Network.responseReceived")).toBe(0);
  });
});
