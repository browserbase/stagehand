import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "new_tab" }, async ({ page, assert, metrics, logger }) => {
    // page comes from v3.context.pages()[0] — we need the context to create new pages
    // Access the context through the page's internal reference
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    // Get the context from the logger (which holds the v3 ref)
    const v3 = logger.stagehand;
    assert.truthy(v3, "V3 instance should be accessible from logger");
    const pagesBefore = v3.context.pages();
    const countBefore = pagesBefore.length;
    const stop = metrics.startTimer("newPage_ms");
    const newPage = await v3.context.newPage();
    stop();
    assert.truthy(newPage, "New page should be created");
    const pagesAfter = v3.context.pages();
    assert.equals(pagesAfter.length, countBefore + 1);
});
