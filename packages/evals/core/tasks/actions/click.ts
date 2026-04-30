import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "click" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.button,
      state: "visible",
      timeoutMs: 5000,
    });

    const stop = metrics.startTimer("click_ms");
    await page.click(dropdownFixture.targets.button);
    stop();

    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.menu,
      state: "visible",
      timeoutMs: 1000,
    });

    const expanded = await page.evaluate<string | null, string>(
      (selector) =>
        document.querySelector(selector)?.getAttribute("aria-expanded") ?? null,
      dropdownFixture.selectors.button,
    );
    assert.equals(
      expanded,
      "true",
      "Dropdown button should be expanded after click",
    );
  },
);
