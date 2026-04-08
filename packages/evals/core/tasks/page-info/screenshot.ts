import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "screenshot" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("screenshot_ms");
    const buffer = await page.screenshot();
    stop();
    assert.truthy(buffer, "Screenshot should return a buffer");
    assert.greaterThan(buffer.byteLength, 0, "Screenshot should not be empty");
});
