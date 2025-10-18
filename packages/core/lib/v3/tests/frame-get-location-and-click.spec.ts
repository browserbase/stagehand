import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Coordinate-based clicking", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("clicking by coordinates toggles a button state", async () => {
    const page = v3.context.pages()[0];

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

    // Initial state should be idle
    let state = await page.mainFrame().evaluate(() => {
      const out = document.getElementById("out");
      return out?.textContent || "";
    });
    expect(state).toBe("idle");

    // Compute button location via Frame.getLocationForSelector
    const { x, y, width, height } = await page
      .mainFrame()
      .getLocationForSelector("#btn");

    // Click near the center of the button using Page.click coordinates
    const cx = Math.round(x + width / 2);
    const cy = Math.round(y + height / 2);
    await page.click(cx, cy);

    state = await page.mainFrame().evaluate(() => {
      const out = document.getElementById("out");
      return out?.textContent || "";
    });
    expect(state).toBe("clicked");

    // Click again to toggle back to idle
    await page.click(cx, cy);
    state = await page.mainFrame().evaluate(() => {
      const out = document.getElementById("out");
      return out?.textContent || "";
    });
    expect(state).toBe("idle");
  });
});
