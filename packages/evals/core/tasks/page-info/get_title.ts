import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "get_title" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("title_ms");
    const title = await page.title();
    stop();
    assert.truthy(title, "Page should have a non-empty title");
    assert.matches(title, /./, "Title should be at least one character");
});
