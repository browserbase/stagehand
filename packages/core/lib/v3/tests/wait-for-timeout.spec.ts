import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Page.waitForTimeout tests", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("waitForTimeout resolves after specified duration", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," + encodeURIComponent("<div>Test Page</div>"),
    );

    const startTime = Date.now();
    await page.waitForTimeout(200);
    const elapsed = Date.now() - startTime;

    // Should have waited at least 200ms (allow some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  test("waitForTimeout resolves immediately for 0ms", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," + encodeURIComponent("<div>Test Page</div>"),
    );

    const startTime = Date.now();
    await page.waitForTimeout(0);
    const elapsed = Date.now() - startTime;

    // Should resolve nearly immediately (within 50ms tolerance)
    expect(elapsed).toBeLessThan(50);
  });

  test("waitForTimeout can be chained with other operations", async () => {
    const page = v3.context.pages()[0];

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

    // Wait for counter to increment
    await page.waitForTimeout(350);

    // Counter should have incremented at least 3 times
    const text = await page.mainFrame().locator("#counter").textContent();
    expect(parseInt(text ?? "0")).toBeGreaterThanOrEqual(3);
  });

  test("waitForTimeout works with async/await syntax", async () => {
    const page = v3.context.pages()[0];

    await page.goto("data:text/html," + encodeURIComponent("<div>Test</div>"));

    const results: number[] = [];

    results.push(1);
    await page.waitForTimeout(50);
    results.push(2);
    await page.waitForTimeout(50);
    results.push(3);

    expect(results).toEqual([1, 2, 3]);
  });

  test("waitForTimeout allows DOM to update", async () => {
    const page = v3.context.pages()[0];

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

    // Trigger the delayed update
    await page.evaluate(() => {
      (window as unknown as { startUpdate: () => void }).startUpdate();
    });

    // Wait for the timeout to allow DOM update
    await page.waitForTimeout(300);

    // Content should now be loaded
    const afterText = await page.mainFrame().locator("#delayed").textContent();
    expect(afterText).toBe("Loaded");
  });

  test("waitForTimeout with small increments", async () => {
    const page = v3.context.pages()[0];

    await page.goto("data:text/html," + encodeURIComponent("<div>Test</div>"));

    const startTime = Date.now();

    // Multiple small waits
    await page.waitForTimeout(50);
    await page.waitForTimeout(50);
    await page.waitForTimeout(50);
    await page.waitForTimeout(50);

    const elapsed = Date.now() - startTime;

    // Should have waited at least 200ms total (4 * 50ms)
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  test("waitForTimeout does not block other async operations", async () => {
    const page = v3.context.pages()[0];

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

    // Start a timeout
    const timeoutPromise = page.waitForTimeout(100);

    // Execute something else while waiting
    await page.evaluate(() => {
      (window as unknown as { updateText: () => void }).updateText();
    });

    // Verify the update happened
    const text = await page.mainFrame().locator("#async-test").textContent();
    expect(text).toBe("Updated");

    // Wait for the timeout to complete
    await timeoutPromise;
  });
});
