import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3BBTestConfig } from "./v3.bb.config";

const PAGE_TARGET_COUNT = 5;

test.describe("connect to existing Browserbase session", () => {
  test("new Stagehand instance reuses an existing Browserbase session", async () => {
    test.skip(
      process.env.TEST_ENV !== "BROWSERBASE",
      "Requires TEST_ENV=BROWSERBASE",
    );
    test.skip(
      !process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID,
      "BROWSERBASE credentials are required",
    );

    const initialStagehand = new V3({
      ...v3BBTestConfig,
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
        logger: v3BBTestConfig.logger,
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
      await resumedStagehand?.close().catch(() => {});
      await initialStagehand.close().catch(() => {});
    }
  });
});
