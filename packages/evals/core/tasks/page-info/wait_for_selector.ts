import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "wait_for_selector" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("waitForSelector_ms");
    const el = await page.waitForSelector("xpath=/html/body/div/div/button", {
        timeout: 5000,
    });
    stop();
    assert.truthy(el, "Should find the button element");
});
