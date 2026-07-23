import { describe, expect, it, vi } from "vite-plus/test";
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
