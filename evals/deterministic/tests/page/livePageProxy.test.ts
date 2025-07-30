import { expect, test } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - live page proxy", () => {
  test("tests that the page URL reflects the URL of the newest opened tab", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
    );
    await page.locator("body > button").click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.waitForURL("**/page2.html", { waitUntil: "commit" });
    // await new Promise(resolve => setTimeout(resolve, 1000));
    const currentURL = page.url();
    const expectedURL =
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html";

    expect(currentURL).toBe(expectedURL);

    await stagehand.close();
  });

  test("tests that opening a new tab does not close the old tab", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
    );
    await page.locator("body > button").click();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const expectedNumPages = 2;
    const actualNumPages = stagehand.context.pages().length;

    expect(actualNumPages).toBe(expectedNumPages);

    await stagehand.close();
  });
});
