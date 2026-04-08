import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "get_url" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("url_ms");
    const url = page.url();
    stop();
    assert.includes(url, "stagehand-eval-sites/sites/dropdown");
    assert.matches(url, /^https?:\/\//);
});
