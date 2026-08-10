import { resistorFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "scroll" },
  async ({ page, assert, metrics }) => {
    await page.goto(resistorFixture.url);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const stop = metrics.startTimer("scroll_ms");
    await page.scroll(400, 300, 0, 500);
    stop();

    await page.wait({
      kind: "timeout",
      timeoutMs: 200,
    });
    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert.greaterThan(
      scrollAfter,
      scrollBefore,
      "Page should have scrolled down",
    );
  },
);
