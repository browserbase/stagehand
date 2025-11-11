import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Locator count() method with iframes", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("count() does not search inside iframes by default", async () => {
    const page = v3.context.pages()[0];

    // Create a page with buttons in main frame and iframe
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <button>Main Frame Button 1</button>
        <button>Main Frame Button 2</button>
        <iframe id="test-iframe" srcdoc="
          <button>Iframe Button 1</button>
          <button>Iframe Button 2</button>
          <button>Iframe Button 3</button>
        "></iframe>
      `),
    );

    // Wait for iframe to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Count buttons in main frame only
    const mainFrameCount = await page.mainFrame().locator("button").count();
    expect(mainFrameCount).toBe(2); // Should only find buttons in main frame
  });

  test("count() works with frameLocator for iframe content", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <button>Main Frame Button</button>
        <iframe id="test-iframe" srcdoc="
          <button>Iframe Button 1</button>
          <button>Iframe Button 2</button>
          <button>Iframe Button 3</button>
        "></iframe>
      `),
    );

    // Wait for iframe to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Count buttons in iframe using frameLocator
    const iframeLocator = page.frameLocator("#test-iframe");
    const iframeCount = await iframeLocator.locator("button").count();
    expect(iframeCount).toBe(3); // Should find 3 buttons in iframe
  });

  test("count() with nested iframes", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <div class="level-0">Main Frame</div>
        <iframe id="frame1" srcdoc="
          <div class='level-1'>Frame 1</div>
          <iframe id='frame2' srcdoc='
            <div class=&quot;level-2&quot;>Frame 2</div>
            <div class=&quot;level-2&quot;>Frame 2</div>
          '></iframe>
        "></iframe>
      `),
    );

    // Wait for all iframes to load
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Count at each level
    const mainCount = await page.mainFrame().locator(".level-0").count();
    expect(mainCount).toBe(1);

    const frame1Count = await page
      .frameLocator("#frame1")
      .locator(".level-1")
      .count();
    expect(frame1Count).toBe(1);

    const frame2Count = await page
      .frameLocator("#frame1")
      .frameLocator("#frame2")
      .locator(".level-2")
      .count();
    expect(frame2Count).toBe(2);
  });

  test("count() with same selector in multiple contexts", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <span class="item">Main 1</span>
        <span class="item">Main 2</span>
        <iframe id="frame1" srcdoc="
          <span class='item'>Frame1 Item</span>
        "></iframe>
        <iframe id="frame2" srcdoc="
          <span class='item'>Frame2 Item 1</span>
          <span class='item'>Frame2 Item 2</span>
          <span class='item'>Frame2 Item 3</span>
        "></iframe>
      `),
    );

    // Wait for iframes to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Count in each context
    const mainCount = await page.mainFrame().locator(".item").count();
    const frame1Count = await page
      .frameLocator("#frame1")
      .locator(".item")
      .count();
    const frame2Count = await page
      .frameLocator("#frame2")
      .locator(".item")
      .count();

    expect(mainCount).toBe(2); // Main frame items only
    expect(frame1Count).toBe(1); // Frame 1 items only
    expect(frame2Count).toBe(3); // Frame 2 items only
  });

  test("count() returns 0 for non-existent iframe", async () => {
    const page = v3.context.pages()[0];

    await page.goto("data:text/html,<div>No iframes here</div>");

    try {
      const frameLocator = page.frameLocator("#non-existent");
      await frameLocator.locator("button").count();
      // If we get here, the test should fail
      expect(true).toBe(false);
    } catch (error) {
      // Expected behavior - frameLocator should throw when iframe doesn't exist
      expect(error.message).toContain(
        "Could not find an element for the given xPath(s):",
      );
    }
  });
});
