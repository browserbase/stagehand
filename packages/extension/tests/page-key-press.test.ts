import { describe, expect, it } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

class FakeCDPSession implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor(readonly id: string) {}

  async send<Result = unknown>(method: string, params?: unknown): Promise<Result> {
    this.calls.push({ method, params });
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

describe("Page keyPress and keyDown printable identity", () => {
  it("dispatches keyDown and keyUp with key, code, and windowsVirtualKeyCode for letters", async () => {
    const session = new FakeCDPSession("main");
    const page = createPage(session);

    await page.keyPress("w");

    const keyEvents = session.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    expect(keyEvents).toHaveLength(2);

    const down = keyEvents[0].params as Protocol.Input.DispatchKeyEventRequest;
    expect(down.type).toBe("keyDown");
    expect(down.key).toBe("w");
    expect(down.code).toBe("KeyW");
    expect(down.windowsVirtualKeyCode).toBe(87);
    expect(down.text).toBe("w");
    expect(down.unmodifiedText).toBe("w");

    const up = keyEvents[1].params as Protocol.Input.DispatchKeyEventRequest;
    expect(up.type).toBe("keyUp");
    expect(up.key).toBe("w");
    expect(up.code).toBe("KeyW");
    expect(up.windowsVirtualKeyCode).toBe(87);
  });

  it("dispatches keydown and keyup for punctuation with correct code and VK (e.g. Period without VK_DELETE collision)", async () => {
    const session = new FakeCDPSession("main");
    const page = createPage(session);

    await page.keyPress(".");

    const keyEvents = session.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    expect(keyEvents).toHaveLength(2);

    const down = keyEvents[0].params as Protocol.Input.DispatchKeyEventRequest;
    expect(down.type).toBe("keyDown");
    expect(down.key).toBe(".");
    expect(down.code).toBe("Period");
    expect(down.windowsVirtualKeyCode).toBe(190);
    // Must NOT be 46 (which is VK_DELETE in Windows virtual key codes)
    expect(down.windowsVirtualKeyCode).not.toBe(46);
    expect(down.text).toBe(".");

    const up = keyEvents[1].params as Protocol.Input.DispatchKeyEventRequest;
    expect(up.type).toBe("keyUp");
    expect(up.key).toBe(".");
    expect(up.code).toBe("Period");
    expect(up.windowsVirtualKeyCode).toBe(190);
  });

  it("handles shifted punctuation and symbols with proper DOM code and VK", async () => {
    const session = new FakeCDPSession("main");
    const page = createPage(session);

    await page.keyPress("!");

    const keyEvents = session.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    expect(keyEvents).toHaveLength(2);

    const down = keyEvents[0].params as Protocol.Input.DispatchKeyEventRequest;
    expect(down.key).toBe("!");
    expect(down.code).toBe("Digit1");
    expect(down.windowsVirtualKeyCode).toBe(49);
  });

  it("preserves key identity in page.type for printable characters", async () => {
    const session = new FakeCDPSession("main");
    const page = createPage(session);

    await page.type("w.");

    const keyEvents = session.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    // 2 chars x (keyDown + keyUp) = 4 events
    expect(keyEvents).toHaveLength(4);

    const wDown = keyEvents[0].params as Protocol.Input.DispatchKeyEventRequest;
    expect(wDown.key).toBe("w");
    expect(wDown.code).toBe("KeyW");
    expect(wDown.windowsVirtualKeyCode).toBe(87);

    const dotDown = keyEvents[2].params as Protocol.Input.DispatchKeyEventRequest;
    expect(dotDown.key).toBe(".");
    expect(dotDown.code).toBe("Period");
    expect(dotDown.windowsVirtualKeyCode).toBe(190);
  });
});
