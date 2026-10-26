import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Page.scroll() - mouse wheel scrolling", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("scrolls page vertically with positive deltaY", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px;">
            <div style="height: 400px; background: lightblue;">Section 1</div>
            <div style="height: 400px; background: lightgreen;">Section 2</div>
            <div style="height: 400px; background: lightyellow;">Section 3</div>
            <div style="height: 400px; background: lightcoral;">Section 4</div>
            <div style="height: 400px; background: lightgray;">Section 5</div>
          </body></html>`,
        ),
    );

    // Get initial scroll position
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Scroll down (positive deltaY)
    await page.scroll(640, 400, 0, 300);

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  it("scrolls page horizontally with positive deltaX", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="width: 2000px; height: 600px;">
            <div style="display: inline-block; width: 400px; height: 100%; background: lightblue;">Section 1</div>
            <div style="display: inline-block; width: 400px; height: 100%; background: lightgreen;">Section 2</div>
            <div style="display: inline-block; width: 400px; height: 100%; background: lightyellow;">Section 3</div>
            <div style="display: inline-block; width: 400px; height: 100%; background: lightcoral;">Section 4</div>
            <div style="display: inline-block; width: 400px; height: 100%; background: lightgray;">Section 5</div>
          </body></html>`,
        ),
    );

    const scrollX = await page.evaluate(() => window.scrollX);
    expect(scrollX).toBe(0);

    // Scroll right (positive deltaX)
    await page.scroll(640, 400, 300, 0);

    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
  });

  it("scrolls in both directions simultaneously", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="width: 2000px; height: 2000px;">
            <div style="width: 100%; height: 100%; background: linear-gradient(135deg, lightblue, lightcoral);">
              Diagonal content
            </div>
          </body></html>`,
        ),
    );

    // Scroll both horizontally and vertically
    await page.scroll(640, 400, 200, 200);

    await expect
      .poll(() => page.evaluate(() => window.scrollX > 0 && window.scrollY > 0))
      .toBe(true);
  });

  it("scrolls at specific coordinate on page", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px;">
            <div id="marker" style="position: fixed; top: 350px; left: 590px; width: 100px; height: 100px; background: red;"></div>
            <div style="height: 500px; background: lightblue;">Top</div>
            <div style="height: 500px; background: lightgreen;">Middle</div>
            <div style="height: 500px; background: lightyellow;">Bottom</div>
            <script>
              marker.dataset.wheelCount = "0";
              marker.addEventListener("wheel", () => {
                marker.dataset.wheelCount = String(Number(marker.dataset.wheelCount) + 1);
              });
            </script>
          </body></html>`,
        ),
    );

    // Scroll from specific coordinates
    await page.scroll(640, 400, 0, 400);

    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("#marker")?.getAttribute("data-wheel-count")),
      )
      .toBe("1");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  it("scrolls with large deltaY values", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 5000px;">
            <div style="height: 1000px; background: lightblue;">Section 1</div>
            <div style="height: 1000px; background: lightgreen;">Section 2</div>
            <div style="height: 1000px; background: lightyellow;">Section 3</div>
            <div style="height: 1000px; background: lightcoral;">Section 4</div>
            <div style="height: 1000px; background: lightgray;">Section 5</div>
          </body></html>`,
        ),
    );

    // Scroll with large delta
    await page.scroll(640, 400, 0, 1000);

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  });

  it("negative deltaY scrolls up", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px;">
            <div style="height: 500px; background: lightblue;">Top</div>
            <div style="height: 500px; background: lightgreen;">Middle 1</div>
            <div style="height: 500px; background: lightyellow;">Middle 2</div>
            <div style="height: 500px; background: lightcoral;">Bottom</div>
          </body></html>`,
        ),
    );

    // First scroll down
    await page.scroll(640, 400, 0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const scrollY = await page.evaluate(() => window.scrollY);
    const scrolledDown = scrollY;
    expect(scrolledDown).toBeGreaterThan(0);

    // Now scroll up (negative delta)
    await page.scroll(640, 400, 0, -300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrolledDown);
  });

  it("multiple sequential scrolls accumulate", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 3000px;">
            <div style="height: 750px; background: lightblue;">Section 1</div>
            <div style="height: 750px; background: lightgreen;">Section 2</div>
            <div style="height: 750px; background: lightyellow;">Section 3</div>
            <div style="height: 750px; background: lightcoral;">Section 4</div>
          </body></html>`,
        ),
    );

    // First scroll
    await page.scroll(640, 400, 0, 200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const after1 = await page.evaluate(() => window.scrollY);

    // Second scroll
    await page.scroll(640, 400, 0, 200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(after1);
  });
});
