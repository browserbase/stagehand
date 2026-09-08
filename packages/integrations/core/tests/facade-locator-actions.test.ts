import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

type Locator = {
  check(options?: { timeout?: number }): Promise<void>;
  uncheck(options?: { timeout?: number }): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
};

async function fixture({
  appearedAt = 0,
  checked = false,
  actionError,
}: {
  appearedAt?: number;
  checked?: boolean;
  actionError?: Error;
} = {}) {
  const click = vi.fn(async () => {
    if (actionError) throw actionError;
  });
  const rawPage = {
    pageId: "test",
    url: async () => "about:blank",
    evaluate: vi.fn(async (expression: string) => {
      const match = expression.match(/return await execute\((.+)\);/);
      if (!match) return { width: 800, height: 600 };
      return { count: Date.now() >= appearedAt ? 1 : 0, value: checked, visible: true };
    }),
    waitForTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    locator: () => ({ click }),
  };
  // Errors and timeout helpers must survive the callback serialization boundary.
  const create = new Function(
    `return (${createPlaywrightCompatRuntime.toString()})`,
  )() as typeof createPlaywrightCompatRuntime;
  const runtime = await create({
    page: rawPage,
    context: { pages: async () => [rawPage] },
  } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
  const page = runtime.page as { locator(selector: string): Locator };
  return { locator: page.locator("input"), click };
}

describe("facade locator action deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

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
