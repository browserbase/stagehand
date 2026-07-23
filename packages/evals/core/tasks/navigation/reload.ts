import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "reload" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("reload_ms");
    await page.reload();
    stop();

    const url = page.url();
    assert.includes(url, "dropdown");
    const title = await page.title();
    assert.equals(title, dropdownFixture.expected.title);
  },
);
