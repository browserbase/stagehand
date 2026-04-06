import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "hover" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");

    const box = await page.evaluate(() => {
      const el = document.querySelector("button");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    assert.truthy(box, "Button should exist");

    const stop = metrics.startTimer("hover_ms");
    await page.hover(box!.x, box!.y);
    stop();
  },
);
