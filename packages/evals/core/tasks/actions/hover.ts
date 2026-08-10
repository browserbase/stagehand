import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "hover" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const box = await page.evaluate<{ x: number; y: number } | null, string>(
      (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      dropdownFixture.selectors.button,
    );

    if (!box) {
      throw new Error("Button should exist and have a bounding rect");
    }
    const stop = metrics.startTimer("hover_ms");
    await page.hover({ kind: "coords", x: box.x, y: box.y });
    stop();

    await page.wait({
      kind: "timeout",
      timeoutMs: 100,
    });

    const status = await page.evaluate<string | null, string>(
      (selector) => document.querySelector(selector)?.textContent ?? null,
      dropdownFixture.selectors.hoverStatus,
    );
    assert.equals(status, dropdownFixture.expected.hoverStatus);
  },
);
