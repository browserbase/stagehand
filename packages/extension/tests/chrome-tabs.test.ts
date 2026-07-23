import { describe, expect, it, vi } from "vite-plus/test";
import {
  ChromeTabTargetAdapter,
  type ChromeDebuggerTarget,
  type ChromeTab,
  type ChromeTabTargetApi,
} from "../understudy/chromeTabs.ts";

function createChromeApi(options: { tabs?: ChromeTab[]; targets?: ChromeDebuggerTarget[] }) {
  const query = vi.fn(async () => options.tabs ?? []);
  const getTargets = vi.fn(async () => options.targets ?? []);
  const update = vi.fn(async (tabId: number) => options.tabs?.find((tab) => tab.id === tabId));
  const updateWindow = vi.fn(async () => ({}));
  const chromeApi: ChromeTabTargetApi = {
    debugger: { getTargets },
    tabs: { query, update },
    windows: { update: updateWindow },
  };
  return { chromeApi, getTargets, query, update, updateWindow };
}

describe("ChromeTabTargetAdapter", () => {
  it("maps the active tab in the last-focused window to its page target", async () => {
    const chrome = createChromeApi({
      tabs: [{ id: 22, windowId: 4 }],
      targets: [
        { id: "worker-target", type: "worker" },
        { id: "page-target", tabId: 22, type: "page" },
      ],
    });

    await expect(new ChromeTabTargetAdapter(chrome.chromeApi).activeTargetId()).resolves.toBe(
      "page-target",
    );
    expect(chrome.query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
    expect(chrome.getTargets).toHaveBeenCalledTimes(1);
  });

  it("uses tab and target ids when pages have duplicate URLs and titles", async () => {
    const chrome = createChromeApi({
      tabs: [{ id: 2, windowId: 1 }],
      targets: [
        { id: "page-one", tabId: 1, type: "page" },
        { id: "page-two", tabId: 2, type: "page" },
      ],
    });
    const adapter = new ChromeTabTargetAdapter(chrome.chromeApi);

    await expect(adapter.activeTargetId()).resolves.toBe("page-two");
    await expect(adapter.tabIdForTargetId("page-one")).resolves.toBe(1);
  });

  it.each([
    { name: "there is no active tab", tabs: [], targets: [] },
    { name: "the active tab has no id", tabs: [{ windowId: 1 }], targets: [] },
    {
      name: "the tab has no debugger target",
      tabs: [{ id: 1, windowId: 1 }],
      targets: [],
    },
    {
      name: "the matching debugger target is not a page",
      tabs: [{ id: 1, windowId: 1 }],
      targets: [{ id: "worker", tabId: 1, type: "worker" }],
    },
  ])("returns undefined when $name", async ({ tabs, targets }) => {
    const chrome = createChromeApi({ tabs, targets });

    await expect(
      new ChromeTabTargetAdapter(chrome.chromeApi).activeTargetId(),
    ).resolves.toBeUndefined();
  });

  it("activates the exact tab for a target and focuses its window", async () => {
    const chrome = createChromeApi({
      tabs: [
        { id: 10, windowId: 1 },
        { id: 20, windowId: 2 },
      ],
      targets: [
        { id: "target-one", tabId: 10, type: "page" },
        { id: "target-two", tabId: 20, type: "page" },
      ],
    });

    await new ChromeTabTargetAdapter(chrome.chromeApi).activateTarget("target-two");

    expect(chrome.update).toHaveBeenCalledWith(20, { active: true });
    expect(chrome.updateWindow).toHaveBeenCalledWith(2, { focused: true });
  });

  it("does not refocus the window when selecting another tab in the same window", async () => {
    const chrome = createChromeApi({
      tabs: [
        { id: 10, windowId: 1 },
        { id: 20, windowId: 1 },
      ],
      targets: [{ id: "target-two", tabId: 20, type: "page" }],
    });

    await new ChromeTabTargetAdapter(chrome.chromeApi).activateTarget("target-two");

    expect(chrome.update).toHaveBeenCalledWith(20, { active: true });
    expect(chrome.updateWindow).not.toHaveBeenCalled();
  });

  it("rejects activation when the target does not map to a page tab", async () => {
    const chrome = createChromeApi({
      targets: [{ id: "worker-target", tabId: 30, type: "worker" }],
    });

    await expect(
      new ChromeTabTargetAdapter(chrome.chromeApi).activateTarget("worker-target"),
    ).rejects.toThrow('Chrome tab for target "worker-target" was not found');
    expect(chrome.update).not.toHaveBeenCalled();
  });

  it("surfaces Chrome API failures", async () => {
    const chrome = createChromeApi({ tabs: [{ id: 1, windowId: 1 }] });
    chrome.getTargets.mockRejectedValueOnce(new Error("debugger targets unavailable"));

    await expect(new ChromeTabTargetAdapter(chrome.chromeApi).activeTargetId()).rejects.toThrow(
      "debugger targets unavailable",
    );
  });

  it("rejects when Chrome does not return the activated tab", async () => {
    const chrome = createChromeApi({
      targets: [{ id: "page-target", tabId: 1, type: "page" }],
    });

    await expect(
      new ChromeTabTargetAdapter(chrome.chromeApi).activateTarget("page-target"),
    ).rejects.toThrow('Chrome did not return tab 1 after activating target "page-target"');
    expect(chrome.updateWindow).not.toHaveBeenCalled();
  });
});
