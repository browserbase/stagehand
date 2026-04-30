import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "get_title" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("title_ms");
    const title = await page.title();
    stop();

    assert.equals(title, dropdownFixture.expected.title);
  },
);
