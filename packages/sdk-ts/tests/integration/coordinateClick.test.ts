import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Coordinate-based clicking", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("clicking by coordinates toggles a button state", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button id="btn" onclick="this.dataset.clicked = (this.dataset.clicked==='1'?'0':'1')">Click</button>
            <div id="out"></div>
            <script>
              const btn = document.getElementById('btn');
              const out = document.getElementById('out');
              const update = () => { out.textContent = btn.dataset.clicked === '1' ? 'clicked' : 'idle'; };
              update();
              btn.addEventListener('click', update);
            </script>
          </body></html>`,
        ),
    );

    let state = await page.evaluate(() => document.getElementById("out")?.textContent || "");
    expect(state).toBe("idle");

    const { x, y } = await page.locator("#btn").centroid();
    await page.click(x, y);

    state = await page.evaluate(() => document.getElementById("out")?.textContent || "");
    expect(state).toBe("clicked");

    await page.click(x, y);
    state = await page.evaluate(() => document.getElementById("out")?.textContent || "");
    expect(state).toBe("idle");
  });
});
