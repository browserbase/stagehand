import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "reload" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("reload_ms");
    await page.reload();
    stop();
    const url = page.url();
    assert.includes(url, "stagehand-eval-sites/sites/dropdown");
});
