import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "new_tab" },
  async ({ page, tool, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    const pagesBefore = await tool.listPages();
    const countBefore = pagesBefore.length;

    const stop = metrics.startTimer("newPage_ms");
    const newPage = await tool.newPage();
    stop();

    assert.truthy(newPage, "New page should be created");
    const pagesAfter = await tool.listPages();
    assert.equals(pagesAfter.length, countBefore + 1);
  },
);
