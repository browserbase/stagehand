import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "click_coordinates" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const box = await page.evaluate<{ x: number; y: number } | null, string>(
      (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      dropdownFixture.selectors.button,
    );

    if (!box) {
      throw new Error("Button should exist and have a bounding rect");
    }
    const stop = metrics.startTimer("click_xy_ms");
    await page.click({ kind: "coords", x: box.x, y: box.y });
    stop();

    await page.wait({
      kind: "selector",
      selector: dropdownFixture.selectors.menu,
      state: "visible",
      timeoutMs: 1000,
    });

    const visible = await page.evaluate<boolean, string>((selector) => {
      const menu = document.querySelector(selector);
      if (!(menu instanceof HTMLElement)) return false;
      return menu.classList.contains("open");
    }, dropdownFixture.selectors.menu);
    assert.truthy(visible, "Dropdown should expand after coordinate click");
  },
);
