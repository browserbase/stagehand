import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Locator and Page click methods", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("locator.click() performs single click by default", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial count
    const countDisplay = page.locator("#count");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Perform single click on the textarea (the clickable area)
    const clickArea = page.locator("#textarea");
    await clickArea.click();

    // Verify count incremented by 1
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("1");
  });

  test("locator.click() with clickCount: 2 performs double-click", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial counts
    const countDisplay = page.locator("#count");
    const dcCountDisplay = page.locator("#dcCount");

    const initialCount = await countDisplay.inputValue();
    const initialDcCount = await dcCountDisplay.inputValue();
    expect(initialCount).toBe("0");
    expect(initialDcCount).toBe("0");

    // Perform double-click on the textarea
    const clickArea = page.locator("#textarea");
    await clickArea.click({ clickCount: 2 });

    // Verify both counters incremented
    // Regular count should be 2 (one for each click in the double-click)
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("2");

    // Double-click count should be 1 (one double-click event detected)
    const newDcCount = await dcCountDisplay.inputValue();
    expect(newDcCount).toBe("1");
  });

  test("locator.click() with clickCount: 3 performs triple-click", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#count");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Perform triple-click on the textarea
    const clickArea = page.locator("#textarea");
    await clickArea.click({ clickCount: 3 });

    // Verify count incremented by 3
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("3");
  });

  test("page.click() performs single click with coordinates", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial count
    const countDisplay = page.locator("#count");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Get the centroid of the textarea to click
    const clickArea = page.locator("#textarea");
    const { x, y } = await clickArea.centroid();

    // Perform single click using page.click() with coordinates
    await page.click(x, y);

    // Verify count incremented by 1
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("1");
  });

  test("page.click() with clickCount: 2 performs double-click", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial counts
    const countDisplay = page.locator("#count");
    const dcCountDisplay = page.locator("#dcCount");

    const initialCount = await countDisplay.inputValue();
    const initialDcCount = await dcCountDisplay.inputValue();
    expect(initialCount).toBe("0");
    expect(initialDcCount).toBe("0");

    // Get the centroid of the textarea to click
    const clickArea = page.locator("#textarea");
    const { x, y } = await clickArea.centroid();

    // Perform double-click using page.click() with coordinates
    await page.click(x, y, { clickCount: 2 });

    // Verify both counters incremented
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("2");

    // Double-click count should be 1
    const newDcCount = await dcCountDisplay.inputValue();
    expect(newDcCount).toBe("1");
  });

  test("page.click() with clickCount: 3 performs triple-click", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/click-test/",
    );

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#count");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Get the centroid of the textarea to click
    const clickArea = page.locator("#textarea");
    const { x, y } = await clickArea.centroid();

    // Perform triple-click using page.click() with coordinates
    await page.click(x, y, { clickCount: 3 });

    // Verify count incremented by 3
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("3");
  });
});
