import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "screenshot" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("screenshot_ms");
    const buffer = await page.screenshot();
    stop();

    assert.truthy(buffer, "Screenshot should return a buffer");
    assert.greaterThan(buffer.byteLength, 0, "Screenshot should not be empty");
  },
);
