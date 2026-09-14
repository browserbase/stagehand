import { describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "../../src/browserContext.js";
import {
  attachStagehandBrowserContext,
  claimStagehandBrowserHandle,
  createStagehandBrowserHandle,
  detachStagehandBrowserContext,
} from "../../src/browser/index.js";

function createBrowser() {
  return createStagehandBrowserHandle({
    provider: "local",
    origin: "launched",
    attachment: {},
    close: vi.fn(),
  });
}

describe("Stagehand browser context", () => {
  it("is unavailable until Stagehand claims the browser and attaches a context", () => {
    const browser = createBrowser();
    const context = {} as BrowserContext;

    expect(() => browser.context).toThrow(
      "Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).",
    );
    expect(() => attachStagehandBrowserContext(browser, context)).toThrow(
      "before Stagehand claims the browser",
    );

    claimStagehandBrowserHandle(browser);
    attachStagehandBrowserContext(browser, context);

    expect(browser.context).toBe(context);
  });

  it("rejects replacement and becomes unavailable after detachment", () => {
    const browser = createBrowser();
    const context = {} as BrowserContext;
    claimStagehandBrowserHandle(browser);
    attachStagehandBrowserContext(browser, context);

    expect(() => attachStagehandBrowserContext(browser, {} as BrowserContext)).toThrow(
      "already has a Stagehand context",
    );

    detachStagehandBrowserContext(browser);

    expect(() => browser.context).toThrow("Browser context is unavailable");
  });
});
