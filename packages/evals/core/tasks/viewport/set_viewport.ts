import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "set_viewport" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("viewport_ms");
    await page.setViewport({ width: 1440, height: 900 });
    stop();

    const viewport = await page.evaluate<{ width: number; height: number }>(
      () => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    assert.equals(viewport.width, 1440);
    assert.equals(viewport.height, 900);
  },
);
