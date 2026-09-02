import { describe, expect, it, vi } from "vitest";
import type { PageCDPEvent } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page, PAGE_TO_CDP_EVENTS, type CDPPageEventName } from "../understudy/page.js";

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
  const pageEventNames: Array<CDPPageEventName> = ["console", "toolsAdded"];
  const randomPageEventName = pageEventNames[Math.floor(Math.random() * pageEventNames.length)];
  it("covers the main session plus current and future OOPIF sessions", () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);
    const events: unknown[] = [];

    const unsubscribe = page.subscribeCDPEvent(randomPageEventName, (event) => {
      events.push(event);
    });
    main.emit(PAGE_TO_CDP_EVENTS[randomPageEventName], { type: "log", args: [] });
    page.adoptOopifSession(child, "frame-child");
    child.emit(PAGE_TO_CDP_EVENTS[randomPageEventName], { type: "warning", args: [] });

    expect(events).toStrictEqual([
      {
        pageId: "target-main",
        method: PAGE_TO_CDP_EVENTS[randomPageEventName],
        params: { type: "log", args: [] },
        sessionId: "main",
        targetId: "target-main",
      },
      {
        pageId: "target-main",
        method: PAGE_TO_CDP_EVENTS[randomPageEventName],
        params: { type: "warning", args: [] },
        sessionId: "child",
        targetId: "target-child",
      },
    ]);

    page.detachOopifSession("child");
    expect(child.listenerCount(PAGE_TO_CDP_EVENTS[randomPageEventName])).toBe(0);
    unsubscribe();
    expect(main.listenerCount(PAGE_TO_CDP_EVENTS[randomPageEventName])).toBe(0);
  });

  it("removes every raw listener when the page is disposed", () => {
    const main = new FakeCDPSession("main");
    const child = new FakeCDPSession("child");
    const page = createPage(main);

    page.adoptOopifSession(child, "frame-child");
    page.subscribeCDPEvent(randomPageEventName, () => {});
    page.dispose();

    expect(main.listenerCount(PAGE_TO_CDP_EVENTS[randomPageEventName])).toBe(0);
    expect(child.listenerCount(PAGE_TO_CDP_EVENTS[randomPageEventName])).toBe(0);
  });

  it("isolates listener failures so other subscriptions still receive the event", () => {
    const main = new FakeCDPSession("main");
    const logError = vi.fn();
    const page = createPage(main, { error: logError } as unknown as StagehandLogger);
    const events: PageCDPEvent[] = [];

    page.subscribeCDPEvent(randomPageEventName, () => {
      throw new Error("listener failed");
    });
    page.subscribeCDPEvent(randomPageEventName, (event) => events.push(event));

    expect(() =>
      main.emit(PAGE_TO_CDP_EVENTS[randomPageEventName], { type: "log", args: [] }),
    ).not.toThrow();
    expect(events).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(
      "Page CDP event listener failed",
      expect.objectContaining({
        category: "page",
        method: PAGE_TO_CDP_EVENTS[randomPageEventName],
        sessionId: "main",
        error: "listener failed",
      }),
    );
  });
});
