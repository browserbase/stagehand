import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - addScriptTag and addStyleTag", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("should inject a script tag and have access to the defined function", async () => {
    const { page } = stagehand;

    await page.setContent(`
      <html>
      <body>
        <h1 id="greeting">Hello, world!</h1>
      </body>
      </html>
    `);

    await page.addScriptTag({
      content: `
        window.sayHello = function() {
          document.getElementById("greeting").textContent = "Hello from injected script!";
        }
      `,
    });

    await page.evaluate(() => {
      const w = window as typeof window & {
        sayHello?: () => void;
      };
      w.sayHello?.();
    });

    const text = await page.locator("#greeting").textContent();
    expect(text).toBe("Hello from injected script!");
  });

  test("should inject a style tag and apply styles", async () => {
    const { page } = stagehand;

    await page.setContent(`
      <html>
      <body>
        <div id="styledDiv">Some text</div>
      </body>
      </html>
    `);

    await page.addStyleTag({
      content: `
        #styledDiv {
          color: red;
          font-weight: bold;
        }
      `,
    });

    const color = await page.evaluate(() => {
      const el = document.getElementById("styledDiv");
      return window.getComputedStyle(el!).color;
    });
    expect(color).toBe("rgb(255, 0, 0)");

    const fontWeight = await page.evaluate(() => {
      const el = document.getElementById("styledDiv");
      return window.getComputedStyle(el!).fontWeight;
    });
    expect(["bold", "700"]).toContain(fontWeight);
  });
});
