import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "type_input" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.input,
      state: "visible",
      timeoutMs: 5000,
    });

    const stop = metrics.startTimer("type_ms");
    await page.type(dropdownFixture.targets.input, "hello world");
    stop();

    const value = await page.evaluate<string | null, string>((selector) => {
      const input = document.querySelector(selector);
      return input instanceof HTMLInputElement ? input.value : null;
    }, dropdownFixture.selectors.input);
    assert.equals(value, "hello world");
  },
);
