import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

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

describe("Locator and Page click methods", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("locator.click() performs single click by default", async () => {
    const page = await firstPage(stagehand);
    await page.goto(doubleClickFixtureUrl);

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial count
    const countDisplay = page.locator("#clickCount");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Perform a single click on the target div.
    const clickArea = page.locator("#target");
    await clickArea.click();

    // Verify count incremented by 1
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("1");
  });

  it("locator.click() with clickCount: 2 performs double-click", async () => {
    const page = await firstPage(stagehand);
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

  it("locator.click() with clickCount: 3 performs triple-click", async () => {
    const page = await firstPage(stagehand);
    await page.goto(doubleClickFixtureUrl);

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#clickCount");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Perform triple-click on the textarea
    const clickArea = page.locator("#target");
    await clickArea.click({ clickCount: 3 });

    // Verify count incremented by 3
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("3");
  });

  it("page.click() performs single click with coordinates", async () => {
    const page = await firstPage(stagehand);
    await page.goto(doubleClickFixtureUrl);

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    // Get initial count
    const countDisplay = page.locator("#clickCount");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Get the centroid of the textarea to click
    const clickArea = page.locator("#target");
    const { x, y } = await clickArea.centroid();

    // Perform single click using page.click() with coordinates
    await page.click(x, y);

    // Verify count incremented by 1
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("1");
  });

  it("page.click() with clickCount: 2 performs double-click", async () => {
    const page = await firstPage(stagehand);
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

  it("page.click() with clickCount: 3 performs triple-click", async () => {
    const page = await firstPage(stagehand);
    await page.goto(doubleClickFixtureUrl);

    // Wait for page to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    const countDisplay = page.locator("#clickCount");
    const initialCount = await countDisplay.inputValue();
    expect(initialCount).toBe("0");

    // Get the centroid of the textarea to click
    const clickArea = page.locator("#target");
    const { x, y } = await clickArea.centroid();

    // Perform triple-click using page.click() with coordinates
    await page.click(x, y, { clickCount: 3 });

    // Verify count incremented by 3
    const newCount = await countDisplay.inputValue();
    expect(newCount).toBe("3");
  });

  it("locator.click() position is relative to the padding box, including transforms", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<style>body{margin:0}</style>
        <div style="height:900px"></div>
        <div id="pad" style="width:200px;height:100px;padding:10px;border:5px solid;margin-left:30px"></div>
        <div id="rot" style="width:100px;height:40px;margin:80px;transform:rotate(90deg)"></div>
        <script>window.hits=[];for (const id of ['pad','rot']) document.getElementById(id).addEventListener('click', e => hits.push([e.target.id, e.offsetX, e.offsetY]));</script>`)}`,
    );

    await page.locator("#pad").click({ position: { x: 0, y: 0 } });
    await page.locator("#pad").click({ position: { x: 37, y: 19 } });
    await page.locator("#rot").click({ position: { x: 10, y: 5 } });

    await expect(
      page.evaluate(() => (window as unknown as { hits: unknown }).hits),
    ).resolves.toEqual([
      ["pad", 0, 0],
      ["pad", 37, 19],
      ["rot", 10, 5],
    ]);
  });
});
