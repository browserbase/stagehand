import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "get_text" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    // Extract text content from the dropdown button
    const button = page.locator("xpath=/html/body/div/div/button");
    assert.truthy(await button.count(), "Button should exist");

    const stop = metrics.startTimer("text_ms");
    const text = await button.textContent();
    stop();

    assert.truthy(text, "Button should have text content");
    assert.greaterThan(text!.length, 0, "Text should not be empty");
  },
);
