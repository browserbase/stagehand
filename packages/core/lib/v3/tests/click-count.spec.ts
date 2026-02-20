import { test, expect } from "@playwright/test";
import { V3 } from "../v3.js";
import { v3TestConfig } from "./v3.config.js";

// Keep double-click verification event-based and deterministic.
// Time-delta counters (Date.now() between mousedowns) are flaky at ms boundaries
// and can miss valid double-clicks when synthetic input lands in the same millisecond.
const doubleClickFixtureUrl = `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html>
  <body>
    <div id="target" style="width: 240px; height: 120px; border: 1px solid #000;">target</div>
    <input id="clickCount" value="0" readonly />
    <input id="dblClickCount" value="0" readonly />
    <input id="lastClickDetail" value="0" readonly />
    <input id="lastDblClickDetail" value="0" readonly />
    <script>
      const target = document.getElementById("target");
      const clickCount = document.getElementById("clickCount");
      const dblClickCount = document.getElementById("dblClickCount");
      const lastClickDetail = document.getElementById("lastClickDetail");
      const lastDblClickDetail = document.getElementById("lastDblClickDetail");
      let clicks = 0;
      let dblClicks = 0;

      target.addEventListener("click", (event) => {
        clicks += 1;
        clickCount.value = String(clicks);
        lastClickDetail.value = String(event.detail);
      });

      target.addEventListener("dblclick", (event) => {
        dblClicks += 1;
        dblClickCount.value = String(dblClicks);
        lastDblClickDetail.value = String(event.detail);
      });
    </script>
  </body>
</html>`)}`;

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
    await page.goto(doubleClickFixtureUrl);
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#clickCount");
    const dcCountDisplay = page.locator("#dblClickCount");
    const clickDetailDisplay = page.locator("#lastClickDetail");
    const dblClickDetailDisplay = page.locator("#lastDblClickDetail");

    const initialCount = await countDisplay.inputValue();
    const initialDcCount = await dcCountDisplay.inputValue();
    expect(initialCount).toBe("0");
    expect(initialDcCount).toBe("0");

    const clickArea = page.locator("#target");
    await clickArea.click({ clickCount: 2 });

    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("2");

    const newDcCount = await dcCountDisplay.inputValue();
    expect(newDcCount).toBe("1");
    // `dblclick` is the browser-level contract for double-click behavior.
    // Verifying `detail=2` ensures the click sequence is recognized as a true multi-click.
    expect(await clickDetailDisplay.inputValue()).toBe("2");
    expect(await dblClickDetailDisplay.inputValue()).toBe("2");
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
    await page.goto(doubleClickFixtureUrl);
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#clickCount");
    const dcCountDisplay = page.locator("#dblClickCount");
    const clickDetailDisplay = page.locator("#lastClickDetail");
    const dblClickDetailDisplay = page.locator("#lastDblClickDetail");

    const initialCount = await countDisplay.inputValue();
    const initialDcCount = await dcCountDisplay.inputValue();
    expect(initialCount).toBe("0");
    expect(initialDcCount).toBe("0");

    const clickArea = page.locator("#target");
    const { x, y } = await clickArea.centroid();

    await page.click(x, y, { clickCount: 2 });

    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("2");

    const newDcCount = await dcCountDisplay.inputValue();
    expect(newDcCount).toBe("1");
    // `dblclick` is the browser-level contract for double-click behavior.
    // Verifying `detail=2` ensures the click sequence is recognized as a true multi-click.
    expect(await clickDetailDisplay.inputValue()).toBe("2");
    expect(await dblClickDetailDisplay.inputValue()).toBe("2");
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
