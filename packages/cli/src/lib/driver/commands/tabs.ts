import { z } from "zod";

import type { DriverPage } from "../session-manager.js";
import type { DriverCommandHandlers } from "./types.js";

export const tabHandlers: DriverCommandHandlers = {
  async "tab.list"(manager) {
    return { tabs: await manager.pageSummaries() };
  },

  async "tab.new"(manager, params) {
    const { url } = z.object({ url: z.string().optional() }).parse(params);
    const context = await manager.browserContext();
    const page = await context.newPage(url);
    await context.setActivePage(page);
    const pages = await context.pages();
    return {
      active: true,
      index: pages.findIndex(
        (candidate: DriverPage) => candidate.pageId === page.pageId,
      ),
      targetId: page.pageId,
      title: await manager.safeTitle(page),
      url: await page.url(),
    };
  },

  async "tab.switch"(manager, params) {
    const { tab } = z.object({ tab: z.string().min(1) }).parse(params);
    const { index, page } = await resolveTab(manager, tab);
    const context = await manager.browserContext();
    await context.setActivePage(page);
    return {
      index,
      switched: true,
      targetId: page.pageId,
      title: await manager.safeTitle(page),
      url: await page.url(),
    };
  },

  async "tab.close"(manager, params) {
    const { tab } = z.object({ tab: z.string().optional() }).parse(params);
    const context = await manager.browserContext();
    const pages = await context.pages();
    if (pages.length === 1) {
      throw new Error("Cannot close the last tab.");
    }

    const active = await context.activePage();
    const resolved = tab
      ? await resolveTab(manager, tab)
      : resolveActiveTab(pages, active ?? null);
    const closedTargetId = resolved.page.pageId;
    const activeTargetId = active?.pageId;
    await resolved.page.close();
    const remainingPages = (await context.pages()).filter(
      (page) => page.pageId !== closedTargetId,
    );
    let selectedPage = activeTargetId
      ? remainingPages.find((page) => page.pageId === activeTargetId)
      : undefined;

    if (!selectedPage) {
      selectedPage =
        remainingPages[Math.min(resolved.index, remainingPages.length - 1)] ??
        remainingPages[0];
      if (selectedPage) {
        await context.setActivePage(selectedPage);
      }
    }

    return {
      closed: true,
      index: resolved.index,
      selectedTargetId: selectedPage?.pageId,
      targetId: closedTargetId,
    };
  },
};

async function resolveTab(
  manager: {
    browserContext: () => Promise<{ pages: () => Promise<DriverPage[]> }>;
  },
  tab: string,
): Promise<{ index: number; page: DriverPage }> {
  const context = await manager.browserContext();
  const pages = await context.pages();
  const index = Number.parseInt(tab, 10);
  if (/^\d+$/.test(tab)) {
    const page = pages[index];
    if (!page)
      throw new Error(
        `Tab index ${index} out of range (0-${pages.length - 1}).`,
      );
    return { index, page };
  }

  const targetIndex = pages.findIndex(
    (page: DriverPage) => page.pageId === tab,
  );
  if (targetIndex === -1) {
    throw new Error(
      `Tab targetId ${tab} was not found. Run browse tab list for current tabs.`,
    );
  }
  return { index: targetIndex, page: pages[targetIndex]! };
}

function resolveActiveTab(
  pages: DriverPage[],
  active: DriverPage | null,
): { index: number; page: DriverPage } {
  const activeTargetId = active?.pageId;
  const index = activeTargetId
    ? pages.findIndex((page) => page.pageId === activeTargetId)
    : 0;
  const page = pages[index] ?? pages[0];
  if (!page) throw new Error("No active tab.");
  return { index: index >= 0 ? index : 0, page };
}
