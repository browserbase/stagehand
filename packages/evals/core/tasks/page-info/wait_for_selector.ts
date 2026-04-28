import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "wait_for_selector" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("waitForSelector_ms");
    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.button,
      state: "visible",
      timeoutMs: 5000,
    });
    stop();

    const buttonExists = await page.evaluate<boolean, string>(
      (selector) => Boolean(document.querySelector(selector)),
      dropdownFixture.selectors.button,
    );
    assert.truthy(buttonExists, "Should find the button element");
  },
);
