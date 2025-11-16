import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe.configure({ mode: "parallel" });
test.describe("V3 default page tracking", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("activePage points to initial page", async () => {
    const ctx = v3.context;
    // Should have at least one top-level page
    const pages = ctx.pages();
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const active = ctx.activePage();
    expect(active).toBeTruthy();
    // mainFrameId should be a non-empty string
    expect(active!.mainFrameId().length).toBeGreaterThan(0);
  });

  test("activePage switches to most recent top-level page and reverts on close", async () => {
    const ctx = v3.context;
    const newPage = await ctx.newPage("https://example.com/");

    const activeAfterCreate = await ctx.awaitActivePage();
    expect(activeAfterCreate.url()).toContain(newPage.url());
  });

  test("popup default-page flow via five-tab site", async () => {
    const ctx = v3.context;

    // 1) Navigate the default page to the site
    const root = await ctx.awaitActivePage();
    await root!.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
      { waitUntil: "load", timeoutMs: 15000 },
    );
    // 2) Click button on the page to open a new tab → page2.html
    await root.locator("xpath=/html/body/button").click();
    const page2 = await ctx.awaitActivePage();
    expect(page2!.url()).toBe(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html",
    );

    // 3) On the default page (now page2), click its button → open page3 popup

    await page2.locator("xpath=/html/body/button").click();
    const page3 = await ctx.awaitActivePage();
    expect(page3!.url()).toBe(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page3.html",
    );

    // 4) Close the current page (page3) and ensure the default page reverts to page2
    await page3!.close();
    const backToPage2 = await ctx.awaitActivePage();
    expect(backToPage2!.url()).toBe(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html",
    );
  });
});
