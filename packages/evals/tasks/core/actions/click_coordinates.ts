import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "click_coordinates" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    // Get the button's position via evaluate
    const box = await page.evaluate(() => {
      const el = document.querySelector("button");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    assert.truthy(box, "Button should exist and have a bounding rect");

    const stop = metrics.startTimer("click_xy_ms");
    await page.click(box!.x, box!.y);
    stop();

    // Verify the dropdown expanded
    await page.waitForTimeout(200);
    const options = page.locator("xpath=/html/body/div/div/ul");
    const visible = await options.isVisible();
    assert.truthy(visible, "Dropdown should expand after coordinate click");
  },
);
