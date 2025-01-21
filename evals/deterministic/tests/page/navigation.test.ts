import { test, expect } from "@playwright/test";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - Navigation", () => {
  test("should navigate back and forward between pages", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;

    await page.goto("https://example.com");
    expect(page.url()).toBe("https://example.com/");

    await page.goto("https://docs.browserbase.com/introduction");
    expect(page.url()).toBe("https://docs.browserbase.com/introduction");

    await page.goBack();
    expect(page.url()).toBe("https://example.com/");

    await page.goForward();
    expect(page.url()).toBe("https://docs.browserbase.com/introduction");

    await stagehand.close();
  });
});
