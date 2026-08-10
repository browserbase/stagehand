import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "evaluate_js" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("evaluate_ms");
    const result = await page.evaluate(() => {
      return {
        title: document.title,
        bodyChildren: document.body.children.length,
        hasHead: !!document.head,
      };
    });
    stop();

    assert.equals(result.title, dropdownFixture.expected.title);
    assert.greaterThan(result.bodyChildren, 0, "Body should have children");
    assert.truthy(result.hasHead, "Document should have a head");
  },
);
