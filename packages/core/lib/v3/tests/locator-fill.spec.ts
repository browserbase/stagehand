import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

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

    const dateInput = page.mainFrame().locator("#date");
    await dateInput.fill("2026-01-01");

    const value = await dateInput.inputValue();
    expect(value).toBe("2026-01-01");
  });
});
