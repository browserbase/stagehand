import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - Reload", () => {
  test("should reload the page and reset page state", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/");

    await page.evaluate(() => {
      const w = window as typeof window & {
        __testReloadMarker?: string;
      };
      w.__testReloadMarker = "Hello Reload!";
    });

    const markerBeforeReload = await page.evaluate(() => {
      const w = window as typeof window & {
        __testReloadMarker?: string;
      };
      return w.__testReloadMarker;
    });
    expect(markerBeforeReload).toBe("Hello Reload!");

    await page.reload();

    const markerAfterReload = await page.evaluate(() => {
      const w = window as typeof window & {
        __testReloadMarker?: string;
      };
      return w.__testReloadMarker;
    });
    expect(markerAfterReload).toBeUndefined();

    await stagehand.close();
  });
});
