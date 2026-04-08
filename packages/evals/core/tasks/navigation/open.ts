import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask({ name: "open" }, async ({ page, assert, metrics }) => {
  const stop = metrics.startTimer("navigation_ms");
  await page.goto(dropdownFixture.url);
  stop();

  const url = page.url();
  assert.includes(url, "dropdown");
  const title = await page.title();
  assert.truthy(title, "Page should have a title");
});
