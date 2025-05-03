import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - evaluateHandle, exposeBinding, exposeFunction", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("demonstrates evaluateHandle, exposeBinding, and exposeFunction", async () => {
    const { page } = stagehand;

    await page.setContent(`
      <html>
        <body>
          <div id="myDiv">Initial Text</div>
        </body>
      </html>
    `);

    const divHandle = await page.evaluateHandle(() => {
      return document.getElementById("myDiv");
    });
    await divHandle.evaluate((div, newText) => {
      div.textContent = newText;
    }, "Text updated via evaluateHandle");

    const text = await page.locator("#myDiv").textContent();
    expect(text).toBe("Text updated via evaluateHandle");

    await page.exposeBinding("myBinding", async (source, arg: string) => {
      console.log("myBinding called from page with arg:", arg);
      return `Node responded with: I got your message: "${arg}"`;
    });

    const responseFromBinding = await page.evaluate(async () => {
      const w = window as typeof window & {
        myBinding?: (arg: string) => Promise<string>;
      };
      return w.myBinding?.("Hello from the browser");
    });
    expect(responseFromBinding).toMatch(/I got your message/);

    await page.exposeFunction("addNumbers", (a: number, b: number) => {
      return a + b;
    });

    const sum = await page.evaluate(async () => {
      const w = window as typeof window & {
        addNumbers?: (a: number, b: number) => number;
      };
      return w.addNumbers?.(3, 7);
    });
    expect(sum).toBe(10);
  });
});
