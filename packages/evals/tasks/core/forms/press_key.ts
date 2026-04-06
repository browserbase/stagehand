import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "press_key" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    // Focus the input field and type via keyboard
    const input = page.locator("xpath=/html/body/div/input");
    await input.click();

    const stop = metrics.startTimer("type_ms");
    await page.type("hello");
    stop();

    const value = await input.inputValue();
    assert.equals(value, "hello");
  },
);
