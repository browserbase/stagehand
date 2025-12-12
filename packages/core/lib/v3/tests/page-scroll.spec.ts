import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page.scroll() - mouse wheel scrolling", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("scrolls page vertically with positive deltaY", async () => {
    const page = v3.context.pages()[0];

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
    let scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Scroll down (positive deltaY)
    await page.scroll(640, 400, 0, 300);

    // Wait for scroll to complete
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Check that we've scrolled down
    scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);
  });

  test("scrolls page horizontally with positive deltaX", async () => {
    const page = v3.context.pages()[0];

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

    let scrollX = await page.evaluate(() => window.scrollX);
    expect(scrollX).toBe(0);

    // Scroll right (positive deltaX)
    await page.scroll(640, 400, 300, 0);

    // Wait for scroll to complete
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Check that we've scrolled right
    scrollX = await page.evaluate(() => window.scrollX);
    expect(scrollX).toBeGreaterThan(0);
  });

  test("scrolls in both directions simultaneously", async () => {
    const page = v3.context.pages()[0];

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

    // Wait for scroll to complete
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Check both directions changed
    const scrollPos = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));

    expect(scrollPos.x).toBeGreaterThan(0);
    expect(scrollPos.y).toBeGreaterThan(0);
  });

  test("scrolls at specific coordinate on page", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px;">
            <div id="marker" style="position: fixed; top: 400px; left: 640px; width: 2px; height: 2px; background: red;"></div>
            <div style="height: 500px; background: lightblue;">Top</div>
            <div style="height: 500px; background: lightgreen;">Middle</div>
            <div style="height: 500px; background: lightyellow;">Bottom</div>
          </body></html>`,
        ),
    );

    // Scroll from specific coordinates
    await page.scroll(640, 400, 0, 400);

    // Wait for scroll to complete
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Verify scroll happened
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);
  });

  test("scrolls with large deltaY values", async () => {
    const page = v3.context.pages()[0];

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

    // Wait for scroll to complete
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Should scroll significantly
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(500);
  });

  test("negative deltaY scrolls up", async () => {
    const page = v3.context.pages()[0];

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
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    let scrollY = await page.evaluate(() => window.scrollY);
    const scrolledDown = scrollY;
    expect(scrolledDown).toBeGreaterThan(0);

    // Now scroll up (negative delta)
    await page.scroll(640, 400, 0, -300);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeLessThan(scrolledDown);
  });

  test("scroll returns xpath when requested", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px; margin: 0; padding: 0;">
            <div id="target" style="position: absolute; top: 0px; left: 400px; width: 300px; height: 100px; background: blue;">
              Target element
            </div>
            <p style="position: absolute; top: 200px; left: 0px;">Content below</p>
          </body></html>`,
        ),
    );

    // Scroll at coordinate (550, 50) which should be directly over the target div
    // div spans: left 400-700px, top 0-100px
    // coordinate 550,50 is within that range
    const xpath = await page.scroll(550, 50, 0, 200, { returnXpath: true });

    // Should return a non-empty xpath string for the element at that coordinate
    expect(typeof xpath).toBe("string");
    expect(xpath.length).toBeGreaterThan(0);
    // Xpath should reference the div or contain "target"
    expect(xpath.toLowerCase()).toMatch(/div|target/);
  });

  test("scroll without returnXpath returns empty string", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="height: 2000px;">
            <div style="height: 500px; background: lightblue;">Content</div>
          </body></html>`,
        ),
    );

    // Scroll without returnXpath
    const result = await page.scroll(640, 400, 0, 200);

    // Should return empty string
    expect(result).toBe("");
  });

  test("multiple sequential scrolls accumulate", async () => {
    const page = v3.context.pages()[0];

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
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    const after1 = await page.evaluate(() => window.scrollY);
    expect(after1).toBeGreaterThan(0);

    // Second scroll
    await page.scroll(640, 400, 0, 200);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    const after2 = await page.evaluate(() => window.scrollY);

    expect(after2).toBeGreaterThan(after1);
  });
});
