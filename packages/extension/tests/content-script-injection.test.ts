import { describe, expect, it, vi } from "vitest";
import {
  type ContentScriptInjectionChrome,
  injectContentScriptIntoOpenTabs,
} from "../service-worker-lifecycle/content-script-injection.ts";

function createChromeApi(
  tabs: Array<{ id?: number; discarded?: boolean; url?: string }>,
  executeScript: (injection: { target: { tabId: number } }) => Promise<unknown> = async () => [],
) {
  return {
    scripting: { executeScript: vi.fn(executeScript) },
    tabs: { query: vi.fn(async () => tabs) },
  } satisfies ContentScriptInjectionChrome;
}

describe("content script injection", () => {
  it("injects into every frame of each open tab", async () => {
    const chromeApi = createChromeApi([
      { id: 1, url: "https://example.com/" },
      { id: 2, url: "file:///tmp/page.html" },
    ]);
    const onError = vi.fn();

    await injectContentScriptIntoOpenTabs(chromeApi, onError);

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({});
    expect(chromeApi.scripting.executeScript.mock.calls).toStrictEqual([
      [{ target: { tabId: 1, allFrames: true }, files: ["content-script.js"], world: "ISOLATED" }],
      [{ target: { tabId: 2, allFrames: true }, files: ["content-script.js"], world: "ISOLATED" }],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips discarded tabs, tabs without an id and pages Chrome will not script", async () => {
    const chromeApi = createChromeApi([
      { id: 1, discarded: true, url: "https://example.com/" },
      { url: "https://example.com/" },
      { id: 3, url: "http://example.com/" },
      { id: 4, url: "about:blank" },
      { id: 5, url: "chrome://newtab/" },
      { id: 6, url: "" },
    ]);

    await injectContentScriptIntoOpenTabs(chromeApi, vi.fn());

    expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chromeApi.scripting.executeScript.mock.calls[0]?.[0].target.tabId).toBe(3);
  });

  it("reports each tab Chrome refuses to script and keeps injecting", async () => {
    const refused = new Map([
      [1, new Error("The extensions gallery cannot be scripted.")],
      [2, new Error("Frame with ID 0 was removed.")],
    ]);
    const tabs = [1, 2, 3].map((id) => ({ id, url: `https://example.com/${id}` }));
    const injected: number[] = [];
    const chromeApi = createChromeApi(tabs, async ({ target }) => {
      const error = refused.get(target.tabId);
      if (error) throw error;
      injected.push(target.tabId);
      return [];
    });
    const onError = vi.fn();

    await injectContentScriptIntoOpenTabs(chromeApi, onError);

    expect(injected).toStrictEqual([3]);
    expect(onError.mock.calls).toStrictEqual([[refused.get(1)], [refused.get(2)]]);
  });

  it("reports a failed tab query", async () => {
    const failure = new Error("tabs unavailable");
    const chromeApi = createChromeApi([]);
    chromeApi.tabs.query.mockRejectedValueOnce(failure);
    const onError = vi.fn();

    await expect(injectContentScriptIntoOpenTabs(chromeApi, onError)).resolves.toBeUndefined();

    expect(onError.mock.calls).toStrictEqual([[failure]]);
  });

  it("logs failures to the worker console by default", async () => {
    const failure = new Error("tabs unavailable");
    const chromeApi = createChromeApi([]);
    chromeApi.tabs.query.mockRejectedValueOnce(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await injectContentScriptIntoOpenTabs(chromeApi);
      expect(consoleError).toHaveBeenCalledWith(
        "Stagehand content script injection failed",
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
