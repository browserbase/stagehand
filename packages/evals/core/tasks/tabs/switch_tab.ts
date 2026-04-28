import { dropdownFixture, resistorFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "switch_tab" },
  async ({ page, tool, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    const page2 = await tool.newPage();
    await page2.goto(resistorFixture.url);

    const pages = await tool.listPages();
    assert.equals(pages.length, 2);

    const stop = metrics.startTimer("switch_ms");
    await tool.selectPage(pages[0].id);
    const url1 = (await tool.activePage()).url();
    await tool.selectPage(page2.id);
    const url2 = (await tool.activePage()).url();
    stop();

    assert.includes(url1, "dropdown");
    assert.includes(url2, "resistor");
  },
);
