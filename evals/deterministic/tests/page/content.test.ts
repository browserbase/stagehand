import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - content", () => {
  test("should retrieve the full HTML content of the page", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    const html = await page.content();
    expect(html).toContain("<title>Example Domain</title>");
    expect(html).toContain("<h1>Example Domain</h1>");

    await stagehand.close();
  });
});
