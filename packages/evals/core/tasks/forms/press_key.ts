import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "press_key" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    await page.click(dropdownFixture.targets.input);

    const stop = metrics.startTimer("press_ms");
    for (const key of ["h", "e", "l", "l", "o"]) {
      await page.press({ kind: "focused" }, key);
    }
    stop();

    const value = await page.evaluate<string | null, string>((selector) => {
      const input = document.querySelector(selector);
      return input instanceof HTMLInputElement ? input.value : null;
    }, dropdownFixture.selectors.input);
    assert.equals(value, "hello");
  },
);
