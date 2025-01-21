import { test, expect } from "@playwright/test";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - addInitScript", () => {
  test("should inject a script before the page loads", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;

    await page.addInitScript(() => {
      const w = window as typeof window & {
        __testInitScriptVar?: string;
      };
      w.__testInitScriptVar = "Hello from init script!";
    });

    await page.goto("https://example.com");

    const result = await page.evaluate(() => {
      const w = window as typeof window & {
        __testInitScriptVar?: string;
      };
      return w.__testInitScriptVar;
    });
    expect(result).toBe("Hello from init script!");

    await page.goto("https://docs.browserbase.com/");
    const resultAfterNavigation = await page.evaluate(() => {
      const w = window as typeof window & {
        __testInitScriptVar?: string;
      };
      return w.__testInitScriptVar;
    });
    expect(resultAfterNavigation).toBe("Hello from init script!");

    await stagehand.close();
  });
});
