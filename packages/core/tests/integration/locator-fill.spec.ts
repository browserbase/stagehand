import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { StagehandLocatorError } from "../../lib/v3/types/public/sdkErrors.js";
import { v3TestConfig } from "./v3.config.js";

test.describe("Locator.fill()", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch((e) => {
      void e;
    });
  });

  test("fills date inputs via value setter even when beforeinput blocks insertText", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="date" type="date" />
            <script>
              const input = document.getElementById('date');
              input.addEventListener('beforeinput', (e) => {
                if (e && e.inputType === 'insertText') e.preventDefault();
              });
            </script>
          </body></html>`,
        ),
    );

    const dateInput = page.mainFrame().locator("xpath=/html/body/input");
    await dateInput.fill("2026-01-01");

    const value = await dateInput.inputValue();
    expect(value).toBe("2026-01-01");
  });

  test("xpath case: throws StagehandLocatorError when fill encounters an exception", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="date" type="date" />
          </body></html>`,
        ),
    );

    await page.waitForSelector("xpath=/html/body/input");

    await page.evaluate(() => {
      const input = document.querySelector("input");
      Object.defineProperty(input, "isConnected", {
        get() {
          throw new Error("boom");
        },
      });
    });

    const dateInput = page.mainFrame().locator("xpath=/html/body/input");
    let error: unknown;
    try {
      await dateInput.fill("2026-01-01");
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(StagehandLocatorError);
    if (error instanceof Error) {
      // Log the message so it's visible in test output.
      expect(error.message).toContain("Error Filling Element");
      expect(error.message).toContain("selector: xpath=/html/body/input");
      expect(error.message).toContain("boom");
    }
  });

  test("css selector case: throws StagehandLocatorError when fill encounters an exception", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="date" type="date" />
          </body></html>`,
        ),
    );

    await page.waitForSelector("#date");

    // Override in main world
    await page.evaluate(() => {
      const input = document.querySelector("input");
      Object.defineProperty(input, "isConnected", {
        get() {
          throw new Error("boom");
        },
        configurable: true,
      });
    });

    // Also override in the isolated world that CSS selectors use
    const frameId = page.mainFrameId();
    const { executionContextId } = await page.sendCDP<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId,
      worldName: "v3-world",
    });

    await page.sendCDP("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector('input');
        if (input) {
          Object.defineProperty(input, 'isConnected', {
            get() { throw new Error("boom"); },
            configurable: true
          });
        }
      })()`,
      contextId: executionContextId,
    });

    const dateInput = page.mainFrame().locator("#date");
    let error: unknown;
    try {
      await dateInput.fill("2026-01-01");
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(StagehandLocatorError);
    if (error instanceof Error) {
      expect(error.message).toContain("Error Filling Element");
      expect(error.message).toContain("selector: #date");
      expect(error.message).toContain("boom");
    }
  });
});
