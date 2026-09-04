import { describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate, resolveLocatorTarget } from "./deepLocator.js";

describe("DeepLocatorDelegate match selection", () => {
  const createDelegate = () => {
    const send = vi.fn().mockResolvedValue({});
    const frame = { session: { send } } as unknown as Frame;
    return { delegate: new DeepLocatorDelegate({} as Page, frame, ".item"), send };
  };

  it("preserves all matches by default and narrows explicit nth() locators", async () => {
    const { delegate } = createDelegate();

    await expect(delegate.real()).resolves.toMatchObject({ nthIndex: -1 });
    await expect(delegate.nth(2).real()).resolves.toMatchObject({ nthIndex: 2 });
    await expect(delegate.first().real()).resolves.toMatchObject({ nthIndex: 0 });
  });

  it("uses the first match for a default single-element resolution", async () => {
    const { delegate } = createDelegate();
    const locator = await delegate.real();
    const resolveAtIndex = vi
      .spyOn(locator.selectorResolver, "resolveAtIndex")
      .mockResolvedValue({ objectId: "node-1", nodeId: null });

    await expect(locator.resolveNode()).resolves.toEqual({ objectId: "node-1", nodeId: null });
    expect(resolveAtIndex).toHaveBeenCalledWith(locator.selectorQuery, 0);
  });

  it("preserves grouped XPath expressions for native evaluation", async () => {
    const frame = {} as Frame;

    await expect(resolveLocatorTarget({} as Page, frame, "xpath=(//div)[2]")).resolves.toEqual({
      frame,
      selector: "xpath=(//div)[2]",
    });
  });
});
