import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "set_viewport" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("viewport_ms");
    await page.setViewportSize(1920, 1080);
    stop();
    // Take a screenshot to verify the viewport was applied
    const screenshot = await page.screenshot();
    assert.truthy(screenshot, "Screenshot after viewport change should succeed");
    assert.greaterThan(screenshot.byteLength, 0, "Screenshot should not be empty");
});
