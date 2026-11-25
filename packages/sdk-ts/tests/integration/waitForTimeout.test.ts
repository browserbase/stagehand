import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Page.waitForTimeout tests", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("waitForTimeout resolves after specified duration", async () => {
    const page = await firstPage(stagehand);

    await page.goto("data:text/html," + encodeURIComponent("<div>Test Page</div>"));

    const startTime = Date.now();
    await page.waitForTimeout(200);
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  it("waitForTimeout(0) resolves and allows subsequent operations", async () => {
    const page = await firstPage(stagehand);

    await page.goto("data:text/html," + encodeURIComponent("<div>Test Page</div>"));

    await page.waitForTimeout(0);
    await expect(page.locator("div").textContent()).resolves.toBe("Test Page");
  });

  it("waitForTimeout can be chained with other operations", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<div id='counter'>0</div>" +
            "<script>" +
            "let count = 0;" +
            "setInterval(() => {" +
            "  count++;" +
            "  document.getElementById('counter').textContent = count;" +
            "}, 100);" +
            "</script>",
        ),
    );

    await page.waitForTimeout(350);

    await expect
      .poll(async () => {
        const text = await page.locator("#counter").textContent();
        return parseInt(text ?? "0");
      })
      .toBeGreaterThanOrEqual(3);
  });

  it("waitForTimeout works with async/await syntax", async () => {
    const page = await firstPage(stagehand);

    await page.goto("data:text/html," + encodeURIComponent("<div>Test</div>"));

    const results: number[] = [];

    results.push(1);
    await page.waitForTimeout(50);
    results.push(2);
    await page.waitForTimeout(50);
    results.push(3);

    expect(results).toEqual([1, 2, 3]);
  });

  it("waitForTimeout allows DOM to update", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<div id='delayed'></div>" +
            "<script>" +
            "window.startUpdate = () => {" +
            "  setTimeout(() => {" +
            "    document.getElementById('delayed').textContent = 'Loaded';" +
            "  }, 200);" +
            "};" +
            "</script>",
        ),
    );

    await page.evaluate(() => {
      (window as unknown as { startUpdate: () => void }).startUpdate();
    });

    await page.waitForTimeout(300);

    const afterText = await page.locator("#delayed").textContent();
    expect(afterText).toBe("Loaded");
  });

  it("waitForTimeout with small increments", async () => {
    const page = await firstPage(stagehand);

    await page.goto("data:text/html," + encodeURIComponent("<div>Test</div>"));

    const startTime = Date.now();

    await page.waitForTimeout(50);
    await page.waitForTimeout(50);
    await page.waitForTimeout(50);
    await page.waitForTimeout(50);

    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  it("waitForTimeout does not block other async operations", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<div id='async-test'>Initial</div>" +
            "<script>" +
            "window.updateText = () => {" +
            "  document.getElementById('async-test').textContent = 'Updated';" +
            "};" +
            "</script>",
        ),
    );

    const timeoutPromise = page.waitForTimeout(100);

    try {
      await page.evaluate(() => {
        (window as unknown as { updateText: () => void }).updateText();
      });

      const text = await page.locator("#async-test").textContent();
      expect(text).toBe("Updated");
    } finally {
      await timeoutPromise;
    }
  });
});
