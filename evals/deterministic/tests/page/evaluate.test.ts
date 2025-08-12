import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - JavaScript Evaluation", () => {
  test("can evaluate JavaScript in the page context", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );

    const sum = await page.evaluate(() => 2 + 2);
    expect(sum).toBe(4);

    const pageTitle = await page.evaluate(() => document.title);
    expect(pageTitle).toMatch(/example/i);

    const obj = await page.evaluate(() => {
      return {
        message: "Hello from the browser",
        userAgent: navigator.userAgent,
      };
    });
    expect(obj).toHaveProperty("message", "Hello from the browser");
    expect(obj.userAgent).toBeDefined();

    await stagehand.close();
  });
});
