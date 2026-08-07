import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserContext, Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

async function waitForActivePage(context: BrowserContext, previousPageId: string): Promise<Page> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const active = await context.activePage();
    if (active && active.pageId !== previousPageId) return active;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the active page to change");
}

describe("default page tracking", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeEach(async () => {
    fixture = await startFixtureServer({
      "/": `<button id="open" onclick="window.open('/page2')">open page 2</button>`,
      "/page2": `<button id="open" onclick="window.open('/page3')">open page 3</button>`,
      "/page3": `<h1>page 3</h1>`,
    });
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("activePage points to the initial page", async () => {
    const pages = await stagehand.browser.context.pages();
    const active = await stagehand.browser.context.activePage();

    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(active?.pageId).toBe(pages[0]?.pageId);
  });

  it("activePage switches to the most recently created page", async () => {
    const initial = await firstPage(stagehand);
    const created = await stagehand.browser.context.newPage(fixture.url);
    const active = await waitForActivePage(stagehand.browser.context, initial.pageId);

    expect(active.pageId).toBe(created.pageId);
  });

  it("activePage follows popups and reverts when the newest page closes", async () => {
    const root = await firstPage(stagehand);
    await root.goto(fixture.url);
    await root.locator("#open").click();

    const page2 = await waitForActivePage(stagehand.browser.context, root.pageId);
    await expect.poll(() => page2.url()).toBe(new URL("/page2", fixture.url).href);
    await page2.locator("#open").click();

    const page3 = await waitForActivePage(stagehand.browser.context, page2.pageId);
    await expect.poll(() => page3.url()).toBe(new URL("/page3", fixture.url).href);
    await page3.close();

    await expect
      .poll(async () => (await stagehand.browser.context.activePage())?.pageId, {
        timeout: 5_000,
        interval: 25,
      })
      .toBe(page2.pageId);
  });
});
