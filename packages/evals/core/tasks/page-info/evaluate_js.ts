import { defineCoreTask } from "../../../framework/defineTask.js";
export default defineCoreTask({ name: "evaluate_js" }, async ({ page, assert, metrics }) => {
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/");
    const stop = metrics.startTimer("evaluate_ms");
    const result = await page.evaluate(() => {
        return {
            title: document.title,
            bodyChildren: document.body.children.length,
            hasHead: !!document.head,
        };
    });
    stop();
    assert.truthy(result.title, "Should return document title");
    assert.greaterThan(result.bodyChildren, 0, "Body should have children");
    assert.truthy(result.hasHead, "Document should have a head");
});
