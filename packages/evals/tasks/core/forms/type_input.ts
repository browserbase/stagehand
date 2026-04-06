import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "type_input" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    const input = page.locator("xpath=/html/body/div/input");
    assert.truthy(await input.count(), "Input field should exist");

    const stop = metrics.startTimer("type_ms");
    await input.fill("hello world");
    stop();

    const value = await input.inputValue();
    assert.equals(value, "hello world");
  },
);
