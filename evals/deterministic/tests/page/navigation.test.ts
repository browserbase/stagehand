import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - Navigation", () => {
  test("should navigate back and forward between pages", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    expect(page.url()).toBe(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example/",
    );

    await page.goto("https://docs.browserbase.com/introduction");
    expect(page.url()).toBe("https://docs.browserbase.com/introduction");

    await page.goBack();
    expect(page.url()).toBe(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example/",
    );

    await page.goForward();
    expect(page.url()).toBe("https://docs.browserbase.com/introduction");

    await stagehand.close();
  });
});
