import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - bringToFront", () => {
  test("should bring a background page to the front and allow further actions", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const { page: page1 } = stagehand;

    const page2 = await stagehand.context.newPage();
    await page2.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    const page2Title = await page2.title();
    console.log("Page2 Title:", page2Title);

    await page1.goto("https://www.google.com");
    const page1TitleBefore = await page1.title();
    console.log("Page1 Title before:", page1TitleBefore);

    await page1.bringToFront();

    await page1.goto("https://docs.browserbase.com");
    const page1TitleAfter = await page1.title();
    console.log("Page1 Title after:", page1TitleAfter);

    await page2.bringToFront();
    const page2URLBefore = page2.url();
    console.log("Page2 URL before navigation:", page2URLBefore);

    await stagehand.close();

    expect(page1TitleBefore).toContain("Google");
    expect(page1TitleAfter).toContain("Browserbase");
    expect(page2Title).toContain("Example Domain");
  });
});
