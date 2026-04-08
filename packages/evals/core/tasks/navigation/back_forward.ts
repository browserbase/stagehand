import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "back_forward" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const firstUrl = page.url();
    // Navigate to a second page to build history
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/resistor/");
    const secondUrl = page.url();
    assert.includes(secondUrl, "resistor");
    // Go back
    const stopBack = metrics.startTimer("goBack_ms");
    await page.goBack();
    stopBack();
    assert.includes(page.url(), "dropdown");
    // Go forward
    const stopForward = metrics.startTimer("goForward_ms");
    await page.goForward();
    stopForward();
    assert.includes(page.url(), "resistor");
});
