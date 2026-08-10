import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

const PAGE_TARGET_COUNT = 5;

test.describe("connect to existing Browserbase session", () => {
  test("new Stagehand instance reuses an existing Browserbase session", async () => {
    const browserTarget = (
      process.env.STAGEHAND_BROWSER_TARGET ?? "local"
    ).toLowerCase();
    const isBrowserbase = browserTarget === "browserbase";
    test.skip(!isBrowserbase, "Requires STAGEHAND_BROWSER_TARGET=browserbase");
    test.skip(
      !process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID,
      "BROWSERBASE credentials are required",
    );

    const initialStagehand = new V3({
      ...v3DynamicTestConfig,
      disableAPI: true,
    });
    await initialStagehand.init();

    let resumedStagehand: V3 | null = null;

    try {
      const ctx = initialStagehand.context;
      const initialPage = ctx.pages()[0];
      expect(initialPage).toBeDefined();

      for (let i = 0; i < PAGE_TARGET_COUNT; i++) {
        await ctx.newPage(`https://example.com/?tab=${i}`);
      }

      await initialPage?.close();
      await expect
        .poll(() => ctx.pages().length, { timeout: 15_000 })
        .toBe(PAGE_TARGET_COUNT);

      const sessionUrl = initialStagehand.connectURL();
      expect(sessionUrl).toBeTruthy();

      resumedStagehand = new V3({
        env: "LOCAL",
        verbose: 0,
        disablePino: true,
        disableAPI: true,
        logger: v3DynamicTestConfig.logger,
        localBrowserLaunchOptions: {
          cdpUrl: sessionUrl,
        },
      });
      await resumedStagehand.init();

      await expect
        .poll(() => resumedStagehand!.context.pages().length, {
          timeout: 15_000,
        })
        .toBe(PAGE_TARGET_COUNT);

      const resumedPagesCount = resumedStagehand.context.pages().length;
      expect(resumedPagesCount).toBe(PAGE_TARGET_COUNT);
    } finally {
      await closeV3(resumedStagehand);
      await closeV3(initialStagehand);
    }
  });

  test("new Stagehand instance initializes when existing browser has zero pages", async () => {
    const browserTarget = (
      process.env.STAGEHAND_BROWSER_TARGET ?? "local"
    ).toLowerCase();
    const isLocal = browserTarget !== "browserbase";
    test.skip(!isLocal, "Requires STAGEHAND_BROWSER_TARGET=local");

    const initialStagehand = new V3({
      ...v3DynamicTestConfig,
      disableAPI: true,
      env: "LOCAL",
    });
    await initialStagehand.init();

    let resumedStagehand: V3 | null = null;

    try {
      const ctx = initialStagehand.context;
      const pages = ctx.pages();
      for (const page of pages) {
        await page.close();
      }

      await expect.poll(() => ctx.pages().length, { timeout: 15_000 }).toBe(0);

      const sessionUrl = initialStagehand.connectURL();
      resumedStagehand = new V3({
        env: "LOCAL",
        verbose: 0,
        disablePino: true,
        disableAPI: true,
        logger: v3DynamicTestConfig.logger,
        localBrowserLaunchOptions: {
          cdpUrl: sessionUrl,
        },
      });

      await resumedStagehand.init();

      await expect
        .poll(() => resumedStagehand!.context.pages().length, {
          timeout: 15_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await closeV3(resumedStagehand);
      await closeV3(initialStagehand);
    }
  });
});
