import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "switch_tab" }, async ({ page, assert, metrics, logger }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const v3 = logger.stagehand;
    assert.truthy(v3, "V3 instance should be accessible from logger");
    // Create a second page and navigate it
    const page2 = await v3.context.newPage();
    await page2.goto("https://browserbase.github.io/stagehand-eval-sites/sites/resistor/");
    const pages = v3.context.pages();
    assert.equals(pages.length, 2);
    // Verify each page has the correct URL
    const stop = metrics.startTimer("switch_ms");
    const url1 = pages[0].url();
    const url2 = pages[1].url();
    stop();
    assert.includes(url1, "dropdown");
    assert.includes(url2, "resistor");
});
