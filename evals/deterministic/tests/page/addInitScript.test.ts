import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
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

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );

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

  test("checks if init scripts are re-added and available even if they've been deleted", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );

    // delete the __stagehandInjected flag, and delete the
    // getScrollableElementXpaths function
    await page.evaluate(() => {
      delete window.getScrollableElementXpaths;
      delete window.__stagehandInjected;
    });

    // attempt to call the getScrollableElementXpaths function
    // which we previously deleted. page.evaluate should realize
    // its been deleted and re-inject it
    const xpaths = await page.evaluate(() => {
      return window.getScrollableElementXpaths();
    });

    await stagehand.close();
    // this is the only scrollable element on the page
    expect(xpaths).toContain("/html");
  });
});
