import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "open" },
  async ({ page, assert, metrics }) => {
    const stop = metrics.startTimer("navigation_ms");
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    stop();

    const url = page.url();
    assert.includes(url, "stagehand-eval-sites/sites/dropdown");

    const title = await page.title();
    assert.truthy(title, "Page should have a title");
  },
);
