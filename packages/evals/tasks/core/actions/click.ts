import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "click" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    // Click the dropdown button
    const button = page.locator("xpath=/html/body/div/div/button");
    assert.truthy(await button.count(), "Dropdown button should exist");

    const stop = metrics.startTimer("click_ms");
    await button.click();
    stop();

    // Verify the dropdown expanded (check for visible options)
    await page.waitForTimeout(200);
    const options = page.locator("xpath=/html/body/div/div/ul");
    const isVisible = await options.isVisible();
    assert.truthy(isVisible, "Dropdown options should be visible after click");
  },
);
