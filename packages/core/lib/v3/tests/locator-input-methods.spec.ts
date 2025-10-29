import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Locator input methods (fill, type, hover, isVisible, isChecked)", () => {
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

  test("Locator.fill() sets input value directly", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="name" type="text" />
            <div id="out"></div>
          </body></html>`,
        ),
    );

    const input = page.mainFrame().locator("#name");
    await input.fill("Hello World");

    const value = await input.inputValue();
    expect(value).toBe("Hello World");
  });

  test("Locator.type() types text character by character", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="search" type="text" />
          </body></html>`,
        ),
    );

    const input = page.mainFrame().locator("#search");
    await input.type("test123", { delay: 10 });

    const value = await input.inputValue();
    expect(value).toBe("test123");
  });

  test("Locator.hover() moves mouse to element center", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button id="btn" onmouseover="this.dataset.hovered='true'" onmouseout="this.dataset.hovered='false'">Hover Me</button>
          </body></html>`,
        ),
    );

    const btn = page.mainFrame().locator("#btn");
    await btn.hover();

    const hovered = await page.mainFrame().evaluate(() => {
      const b = document.getElementById("btn") as HTMLButtonElement | null;
      return b?.dataset.hovered === "true";
    });

    expect(hovered).toBe(true);
  });

  test("Locator.isVisible() returns true for visible elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="visible">I am visible</div>
            <div id="hidden" style="display:none">I am hidden</div>
            <div id="invisible" style="visibility:hidden">I am invisible</div>
            <div id="transparent" style="opacity:0">I am transparent</div>
            <div id="zero-size" style="width:0;height:0">Zero size</div>
          </body></html>`,
        ),
    );

    const visible = await page.mainFrame().locator("#visible").isVisible();
    expect(visible).toBe(true);

    const hidden = await page.mainFrame().locator("#hidden").isVisible();
    expect(hidden).toBe(false);

    const invisible = await page.mainFrame().locator("#invisible").isVisible();
    expect(invisible).toBe(false);

    const transparent = await page
      .mainFrame()
      .locator("#transparent")
      .isVisible();
    expect(transparent).toBe(false);

    const zeroSize = await page.mainFrame().locator("#zero-size").isVisible();
    expect(zeroSize).toBe(false);
  });

  test("Locator.isChecked() detects checkbox state", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="checked" type="checkbox" checked />
            <input id="unchecked" type="checkbox" />
            <input id="radio-selected" type="radio" name="opt" checked />
            <input id="radio-unselected" type="radio" name="opt" />
          </body></html>`,
        ),
    );

    const checked = await page.mainFrame().locator("#checked").isChecked();
    expect(checked).toBe(true);

    const unchecked = await page.mainFrame().locator("#unchecked").isChecked();
    expect(unchecked).toBe(false);

    const radioSelected = await page
      .mainFrame()
      .locator("#radio-selected")
      .isChecked();
    expect(radioSelected).toBe(true);

    const radioUnselected = await page
      .mainFrame()
      .locator("#radio-unselected")
      .isChecked();
    expect(radioUnselected).toBe(false);
  });

  test("Locator.fill() on textarea", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <textarea id="ta"></textarea>
          </body></html>`,
        ),
    );

    const ta = page.mainFrame().locator("#ta");
    await ta.fill("Multi\nline\ntext");

    const value = await ta.inputValue();
    expect(value).toBe("Multi\nline\ntext");
  });

  test("Locator.fill() clears and sets new value", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="inp" type="text" value="initial" />
          </body></html>`,
        ),
    );

    const inp = page.mainFrame().locator("#inp");

    let value = await inp.inputValue();
    expect(value).toBe("initial");

    await inp.fill("replaced");
    value = await inp.inputValue();
    expect(value).toBe("replaced");
  });
});
