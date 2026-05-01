import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "get_text" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.button,
      state: "visible",
      timeoutMs: 5000,
    });

    const stop = metrics.startTimer("text_ms");
    const text = await page.evaluate<string | null, string>(
      (selector) => document.querySelector(selector)?.textContent ?? null,
      dropdownFixture.selectors.button,
    );
    stop();

    assert.equals(text, dropdownFixture.expected.buttonText);
  },
);
