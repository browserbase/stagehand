import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

type Locator = {
  check(options?: { timeout?: number }): Promise<void>;
  uncheck(options?: { timeout?: number }): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  dragTo(target: Locator, options?: { timeout?: number }): Promise<void>;
};

async function fixture({
  appearedAt = 0,
  checked = false,
  actionError,
  dispatchMouseEvent,
}: {
  appearedAt?: number;
  checked?: boolean;
  actionError?: Error;
  dispatchMouseEvent?: (pageId: string, event: unknown) => Promise<void>;
} = {}) {
  const click = vi.fn(async () => {
    if (actionError) throw actionError;
  });
  const mouseClick = vi.fn(async () => {});
  const hover = vi.fn(async () => {});
  const rawPage = {
    pageId: "test",
    click: mouseClick,
    hover,
    url: async () => "about:blank",
    evaluate: vi.fn(async (expression: string) => {
      const match = expression.match(/return await execute\((.+)\);/);
      if (!match) return { width: 800, height: 600 };
      return { count: Date.now() >= appearedAt ? 1 : 0, value: checked, visible: true };
    }),
    waitForTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    locator: () => ({ click, count: async () => (Date.now() >= appearedAt ? 1 : 0) }),
  };
  // Errors and timeout helpers must survive the callback serialization boundary.
  const create = new Function(
    `return (${createPlaywrightCompatRuntime.toString()})`,
  )() as typeof createPlaywrightCompatRuntime;
  const runtime = await create({
    page: rawPage,
    context: { pages: async () => [rawPage] },
    dispatchMouseEvent,
  } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
  const page = runtime.page as {
    locator(selector: string): Locator;
    frameLocator(selector: string): { locator(selector: string): Locator };
    mouse: {
      click(x: number, y: number, options?: { button: "right"; clickCount: number }): Promise<void>;
      move(x: number, y: number): Promise<void>;
      wheel(deltaX: number, deltaY: number): Promise<void>;
      down(): Promise<void>;
      up(): Promise<void>;
    };
  };
  return {
    locator: page.locator("input"),
    frameLocator: page.frameLocator("iframe").locator("input"),
    click,
    mouse: page.mouse,
    mouseClick,
    hover,
  };
}

it("preserves legacy mouse behavior with an older extension", async () => {
  const { locator, mouse, mouseClick, hover } = await fixture();
  await mouse.move(10, 20);
  await mouse.down();
  await mouse.move(30, 40);
  await mouse.up();
  await mouse.up();
  expect(hover.mock.calls).toEqual([
    [10, 20],
    [30, 40],
  ]);
  expect(mouseClick).toHaveBeenCalledExactlyOnceWith(30, 40, { button: "left", clickCount: 1 });
  await expect(locator.dragTo(locator)).rejects.toThrow(/extension with callback mouse support/);
  expect(mouseClick).toHaveBeenCalledOnce();
});

it("preserves held buttons across clicks and wheel events", async () => {
  const dispatchMouseEvent = vi.fn(async (_pageId: string, _event: unknown) => {});
  const { locator, mouse, mouseClick } = await fixture({ dispatchMouseEvent });
  await mouse.down();
  await expect(locator.dragTo(locator)).rejects.toThrow(/left mouse button is already down/);
  await mouse.click(30, 40, { button: "right", clickCount: 2 });
  await mouse.wheel(0, 100);
  await mouse.up();
  expect(mouseClick).not.toHaveBeenCalled();
  expect(dispatchMouseEvent.mock.calls.map(([, event]) => event)).toEqual([
    { type: "mousePressed", x: 0, y: 0, button: "left", buttons: 1, clickCount: 1 },
    { type: "mouseMoved", x: 30, y: 40, button: "left", buttons: 1 },
    { type: "mousePressed", x: 30, y: 40, button: "right", buttons: 3, clickCount: 1 },
    { type: "mouseReleased", x: 30, y: 40, button: "right", buttons: 1, clickCount: 1 },
    { type: "mousePressed", x: 30, y: 40, button: "right", buttons: 3, clickCount: 2 },
    { type: "mouseReleased", x: 30, y: 40, button: "right", buttons: 1, clickCount: 2 },
    { type: "mouseWheel", x: 30, y: 40, buttons: 1, deltaX: 0, deltaY: 100 },
    { type: "mouseReleased", x: 30, y: 40, button: "left", buttons: 0, clickCount: 1 },
  ]);
});

describe("facade locator action deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("expires a queued drag and skips it when mouse input becomes available", async () => {
    const dispatchMouseEvent = vi
      .fn(async () => {})
      .mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
    const { locator, mouse } = await fixture({ dispatchMouseEvent });
    const move = mouse.move(10, 20);
    const drag = expect(locator.dragTo(locator, { timeout: 50 })).rejects.toThrow(
      /timed out waiting for mouse input/,
    );
    await vi.advanceTimersByTimeAsync(50);
    await drag;
    await vi.advanceTimersByTimeAsync(450);
    await move;
    await mouse.move(20, 30);
    expect(dispatchMouseEvent).toHaveBeenCalledTimes(2);
  });

  describe.each(["locator", "frameLocator"] as const)("%s forwarding", (kind) => {
    it.each([undefined, 0, 75])("forwards timeout %s to the native action", async (timeout) => {
      const fixtureResult = await fixture();
      await fixtureResult[kind].click(timeout === undefined ? {} : { timeout });
      expect(fixtureResult.click).toHaveBeenCalledWith({ timeout: timeout ?? 10_000 });
    });

    it("forwards only the budget left after finding the target", async () => {
      const fixtureResult = await fixture({ appearedAt: 100 });
      const pending = fixtureResult[kind].click({ timeout: 150 });
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(fixtureResult.click).toHaveBeenCalledWith({ timeout: 50 });
    });
  });

  it.each(["check", "uncheck"] as const)("bounds the absent-element %s probe", async (method) => {
    const { locator, click } = await fixture({ appearedAt: Infinity });
    const pending = expect(locator[method]({ timeout: 60 })).rejects.toThrow(/60ms/);
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(click).not.toHaveBeenCalled();
  });

  it.each(["check", "uncheck"] as const)(
    "shares one budget across %s probing and action",
    async (method) => {
      const { locator, click } = await fixture({
        appearedAt: 100,
        checked: method === "uncheck",
        actionError: new Error("Node does not have a layout object apiKey=private-credential"),
      });
      const pending = expect(locator[method]({ timeout: 150 })).rejects.toMatchObject({
        name: "StagehandFacadeActionError",
        message: expect.stringContaining("after 50ms"),
      });
      await vi.advanceTimersByTimeAsync(150);
      await pending;
      expect(click).toHaveBeenCalled();
    },
  );

  it("keeps timeout zero unlimited across probing and action", async () => {
    const { locator, click } = await fixture({ appearedAt: 100 });
    const pending = locator.check({ timeout: 0 });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(click).toHaveBeenCalledOnce();
  });

  it("omits raw layout errors from the typed action diagnostic", async () => {
    const { locator } = await fixture({
      actionError: new Error("Node does not have a layout object apiKey=private-credential"),
    });
    const pending = locator.click({ timeout: 5 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5);
    const error = (await pending) as Error;
    expect(error.name).toBe("StagehandFacadeActionError");
    expect(error.message).toContain("element matched but is not rendered");
    expect(error.message).not.toContain("private-credential");
    expect(error.stack).not.toContain("private-credential");
  });
});
