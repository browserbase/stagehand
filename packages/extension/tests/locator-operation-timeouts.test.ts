import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutBudget } from "../timeoutBudget.js";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { DeepLocatorDelegate } from "../understudy/deepLocator.js";
import type { Locator } from "../understudy/locator.js";
import { Frame } from "../understudy/frame.js";
import { LocatorOperation } from "../understudy/locatorOperation.js";
import { Page } from "../understudy/page.js";

function sessionWith(send: CDPSessionLike["send"]): CDPSessionLike {
  return { id: "s", send, on: vi.fn(), off: vi.fn(), close: vi.fn() };
}

describe("locator operation timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts a fresh overall deadline for each call on a reusable locator", async () => {
    const delegate = new DeepLocatorDelegate({} as Page, {} as Frame, "#button");
    const budgets: TimeoutBudget[] = [];
    vi.spyOn(delegate, "real").mockImplementation(async (operation) => {
      budgets.push(operation!.budget);
      return { highlight: () => new Promise<void>(() => {}) } as unknown as Locator;
    });
    for (let i = 0; i < 2; i++) {
      // Constructing or retaining a locator must not start the deadline.
      await vi.advanceTimersByTimeAsync(6000);
      const result = delegate.highlight();
      const rejected = expect(result).rejects.toThrow("5000ms");
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
    }
    expect(budgets[0]).not.toBe(budgets[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to five seconds for the entire operation", async () => {
    const operation = new LocatorOperation();
    const result = operation.run(() => new Promise<void>(() => {}));
    const rejected = expect(result).rejects.toThrow("5000ms");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explicit zero disables the entire operation deadline", async () => {
    const operation = new LocatorOperation(new TimeoutBudget(0));
    let finish!: () => void;
    const result = operation.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(operation.budget.remainingMs()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await result;
  });

  it("inherits a caller budget instead of applying the default", async () => {
    const budget = new TimeoutBudget(15000);
    await vi.advanceTimersByTimeAsync(14000);
    const operation = new LocatorOperation(budget);
    expect(operation.budget).toBe(budget);
    expect(operation.budget.remainingMs()).toBe(1000);
    await expect(operation.run(() => "ready")).resolves.toBe("ready");
    const result = operation.run(() => new Promise<void>(() => {}));
    const rejected = expect(result).rejects.toThrow("15000ms");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });

  it("bounds initial CDP setup with the default overall allowance", async () => {
    const send = vi.fn(() => new Promise(() => {}));
    const frame = new Frame(
      sessionWith(send as CDPSessionLike["send"]),
      "f",
      "p",
      false,
      {} as StagehandLogger,
    );
    const locator = frame.locator("#button", undefined, new LocatorOperation());
    const rejected = expect(locator.click()).rejects.toThrow("5000ms");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(send).toHaveBeenCalledExactlyOnceWith("Runtime.enable", undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases late remote objects and prevents subsequent dispatch", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const send = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({});
    const session = sessionWith(send);
    const operation = new LocatorOperation(new TimeoutBudget(50));
    const result = operation.send(session, "Runtime.evaluate");
    const rejected = expect(result).rejects.toThrow("50ms");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    finish({ result: { objectId: "late-object" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "late-object" });
    await expect(operation.send(session, "Input.dispatchMouseEvent")).rejects.toThrow("50ms");
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([60, 100])(
    "selector wait includes %sms of helper setup and cancels DOM waiting",
    async (setupMs) => {
      const send = vi.fn(async (method: string, params?: object) => {
        const expression = (params as { expression?: string })?.expression;
        if (method === "Runtime.evaluate" && expression?.includes('scripts["waitForSelector"]'))
          return new Promise(() => {});
        return {};
      });
      const frame = new Frame(
        sessionWith(send as CDPSessionLike["send"]),
        "f",
        "p",
        false,
        {} as StagehandLogger,
      );
      vi.spyOn(executionContexts, "waitForLocatorWorldReady").mockImplementation(
        async (_s, _f, budget) => {
          await budget.wait(setupMs);
          return { kind: "extension", contextId: 7, capabilities: { closedShadowRoots: true } };
        },
      );
      const page = { mainFrameWrapper: frame } as unknown as Page;
      const waiting = Page.prototype.waitForSelector.call(page, "#button", { timeout: 100 });
      const rejected = expect(waiting).rejects.toThrow(
        'waitForSelector("#button") timed out after 100ms',
      );
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      const expressions = send.mock.calls.map(
        ([, params]) => (params as { expression?: string })?.expression ?? "",
      );
      if (setupMs < 100) {
        expect(expressions.some((expression) => expression.includes('"visible", 40,'))).toBe(true);
        expect(
          expressions.some((expression) => expression.includes('scripts["cancelWaitForSelector"]')),
        ).toBe(true);
      } else {
        expect(
          expressions.some((expression) => expression.includes('scripts["waitForSelector"]')),
        ).toBe(false);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
