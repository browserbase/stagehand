import { describe, expect, it, vi } from "vitest";
import { PageNotFoundError } from "../errors.ts";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import { V3Context } from "../understudy/context.ts";
import type { Page } from "../understudy/page.ts";

function createContext(activeTargetId?: string) {
  const chromeTabs: ChromeTabTargetController = {
    activeTargetId: vi.fn(async () => activeTargetId),
    targetIdForTabId: vi.fn(async () => undefined),
    tabIdForTargetId: vi.fn(async () => undefined),
    activateTarget: vi.fn(async () => {}),
  };
  const context = new V3Context({} as never, {} as never, chromeTabs);
  return { chromeTabs, context };
}

function createPage(targetId: string): Page {
  return { targetId: () => targetId } as Page;
}

describe("V3Context active page", () => {
  it("resolves Chrome's active target through the understudy page registry", async () => {
    const { chromeTabs, context } = createContext("page-target");
    const page = createPage("page-target");
    context.pagesByTarget.set("page-target", page);

    await expect(context.activePage()).resolves.toBe(page);
    expect(chromeTabs.activeTargetId).toHaveBeenCalledOnce();
  });

  it("returns undefined when Chrome's active target is not registered", async () => {
    const { context } = createContext("unregistered-target");

    await expect(context.activePage()).resolves.toBeUndefined();
  });

  it("returns the newly registered page after Page.windowOpen", async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      id: "session-1",
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    };
    const chromeTabs: ChromeTabTargetController = {
      activeTargetId: vi.fn(async () => "old-target"),
      targetIdForTabId: vi.fn(async () => undefined),
      tabIdForTargetId: vi.fn(async () => undefined),
      activateTarget: vi.fn(async () => {}),
    };
    const context = new V3Context(
      { getSession: () => session } as never,
      {} as never,
      chromeTabs,
      "BROWSERBASE",
    );
    const oldPage = createPage("old-target");
    const newPage = createPage("new-target");
    context.pagesByTarget.set("old-target", oldPage);
    context.createdAtByTarget.set("old-target", 0);
    context.installFrameEventBridges("session-1", oldPage);

    listeners.get("Page.windowOpen")?.();
    context.pagesByTarget.set("new-target", newPage);
    context.createdAtByTarget.set("new-target", Date.now() + 1);

    await expect(context.awaitActivePage(100)).resolves.toBe(newPage);
  });

  it("falls back to the prior active page when popup registration times out", async () => {
    const { context } = createContext("page-target");
    const page = createPage("page-target");
    context.pagesByTarget.set("page-target", page);
    Reflect.set(context, "_lastPopupSignalAt", Date.now());

    await expect(context.awaitActivePage(0)).resolves.toBe(page);
  });

  it("throws when no active page becomes available", async () => {
    const { context } = createContext();

    await expect(context.awaitActivePage(0)).rejects.toBeInstanceOf(PageNotFoundError);
  });

  it("uses the Chrome-backed active page for implicit clipboard operations", async () => {
    const { chromeTabs, context } = createContext("page-target");
    const page = createPage("page-target");
    context.pagesByTarget.set("page-target", page);

    await expect(context.clipboard.resolvePage()).resolves.toBe(page);
    expect(chromeTabs.activeTargetId).toHaveBeenCalledOnce();
  });

  it("activates the Chrome tab for a page owned by the context", async () => {
    const { chromeTabs, context } = createContext();
    const page = createPage("page-target");
    context.pagesByTarget.set("page-target", page);

    await context.setActivePage(page);

    expect(chromeTabs.activateTarget).toHaveBeenCalledWith("page-target");
  });

  it("rejects a page that is not owned by the context", async () => {
    const { chromeTabs, context } = createContext();

    await expect(context.setActivePage(createPage("foreign-target"))).rejects.toThrow(
      'Cannot activate unknown Stagehand page "foreign-target"',
    );
    expect(chromeTabs.activateTarget).not.toHaveBeenCalled();
  });
});
