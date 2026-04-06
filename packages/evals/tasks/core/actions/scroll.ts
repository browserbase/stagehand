import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "scroll" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/resistor/");

    // Get scroll position before
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const stop = metrics.startTimer("scroll_ms");
    await page.scroll(400, 300, 0, 500);
    stop();

    // Wait for scroll to settle
    await page.waitForTimeout(200);

    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert.greaterThan(scrollAfter, scrollBefore, "Page should have scrolled down");
  },
);
