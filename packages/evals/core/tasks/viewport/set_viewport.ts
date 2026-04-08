import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask({ name: "set_viewport" }, async ({ page, assert, metrics }) => {
  await page.goto(dropdownFixture.url);

  const stop = metrics.startTimer("viewport_ms");
  await page.setViewportSize(1920, 1080);
  stop();

  const screenshot = await page.screenshot();
  assert.truthy(screenshot, "Screenshot after viewport change should succeed");
  assert.greaterThan(screenshot.byteLength, 0, "Screenshot should not be empty");
});
