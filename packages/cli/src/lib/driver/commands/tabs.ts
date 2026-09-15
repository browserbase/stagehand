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
    context.setActivePage(page);
    return {
      active: true,
      index: context
        .pages()
        .findIndex(
          (candidate: DriverPage) => candidate.targetId() === page.targetId(),
        ),
      targetId: page.targetId(),
      title: await manager.safeTitle(page),
      url: page.url(),
    };
  },

  async "tab.switch"(manager, params) {
    const { tab } = z.object({ tab: z.string().min(1) }).parse(params);
    const { index, page } = await resolveTab(manager, tab);
    const context = await manager.browserContext();
    context.setActivePage(page);
    return {
      index,
      switched: true,
      targetId: page.targetId(),
      title: await manager.safeTitle(page),
      url: page.url(),
    };
  },

  async "tab.close"(manager, params) {
    const { tab } = z.object({ tab: z.string().optional() }).parse(params);
    const context = await manager.browserContext();
    const pages = context.pages();
    if (pages.length === 1) {
      throw new Error("Cannot close the last tab.");
    }

    const active = context.activePage();
    const resolved = tab
      ? await resolveTab(manager, tab)
      : resolveActiveTab(pages, active ?? null);
    const closedTargetId = resolved.page.targetId();
    const activeTargetId = active?.targetId();
    await resolved.page.close();
    const remainingPages = context
      .pages()
      .filter((page) => page.targetId() !== closedTargetId);
    let selectedPage = activeTargetId
      ? remainingPages.find((page) => page.targetId() === activeTargetId)
      : undefined;

    if (!selectedPage) {
      selectedPage =
        remainingPages[Math.min(resolved.index, remainingPages.length - 1)] ??
        remainingPages[0];
      if (selectedPage) {
        context.setActivePage(selectedPage);
      }
    }

    return {
      closed: true,
      index: resolved.index,
      selectedTargetId: selectedPage?.targetId(),
      targetId: closedTargetId,
    };
  },
};

async function resolveTab(
  manager: { browserContext: () => Promise<{ pages: () => DriverPage[] }> },
  tab: string,
): Promise<{ index: number; page: DriverPage }> {
  const context = await manager.browserContext();
  const pages = context.pages();
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
    (page: DriverPage) => page.targetId() === tab,
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
  const activeTargetId = active?.targetId();
  const index = activeTargetId
    ? pages.findIndex((page) => page.targetId() === activeTargetId)
    : 0;
  const page = pages[index] ?? pages[0];
  if (!page) throw new Error("No active tab.");
  return { index: index >= 0 ? index : 0, page };
}
