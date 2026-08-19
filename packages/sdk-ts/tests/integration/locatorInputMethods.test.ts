import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Locator input methods (fill, type, hover, isVisible, isChecked)", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("Locator.fill() sets input value directly", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="name" type="text" />
            <div id="out"></div>
          </body></html>`,
        ),
    );

    const input = page.locator("#name");
    await input.fill("Hello World");

    const value = await input.inputValue();
    expect(value).toBe("Hello World");
  });

  it("Locator.type() types text character by character", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="search" type="text" />
          </body></html>`,
        ),
    );

    const input = page.locator("#search");
    await input.type("test123", { delay: 10 });

    const value = await input.inputValue();
    expect(value).toBe("test123");
  });

  it("Locator.hover() moves mouse to element center", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button id="btn" onmouseover="this.dataset.hovered='true'" onmouseout="this.dataset.hovered='false'">Hover Me</button>
          </body></html>`,
        ),
    );

    const btn = page.locator("#btn");
    await btn.hover();

    const hovered = await page.evaluate(() => {
      const b = document.getElementById("btn") as HTMLButtonElement | null;
      return b?.dataset.hovered === "true";
    });

    expect(hovered).toBe(true);
  });

  it("Locator.isVisible() returns true for visible elements", async () => {
    const page = await firstPage(stagehand);

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

    const visible = await page.locator("#visible").isVisible();
    expect(visible).toBe(true);

    const hidden = await page.locator("#hidden").isVisible();
    expect(hidden).toBe(false);

    const invisible = await page.locator("#invisible").isVisible();
    expect(invisible).toBe(false);

    const transparent = await page.locator("#transparent").isVisible();
    expect(transparent).toBe(false);

    const zeroSize = await page.locator("#zero-size").isVisible();
    expect(zeroSize).toBe(false);
  });

  it("Locator.isChecked() detects checkbox state", async () => {
    const page = await firstPage(stagehand);

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

    const checked = await page.locator("#checked").isChecked();
    expect(checked).toBe(true);

    const unchecked = await page.locator("#unchecked").isChecked();
    expect(unchecked).toBe(false);

    const radioSelected = await page.locator("#radio-selected").isChecked();
    expect(radioSelected).toBe(true);

    const radioUnselected = await page.locator("#radio-unselected").isChecked();
    expect(radioUnselected).toBe(false);
  });

  it("Locator.fill() on textarea", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <textarea id="ta"></textarea>
          </body></html>`,
        ),
    );

    const ta = page.locator("#ta");
    await ta.fill("Multi\nline\ntext");

    const value = await ta.inputValue();
    expect(value).toBe("Multi\nline\ntext");
  });

  it("Locator.fill() clears and sets new value", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="inp" type="text" value="initial" />
          </body></html>`,
        ),
    );

    const inp = page.locator("#inp");

    let value = await inp.inputValue();
    expect(value).toBe("initial");

    await inp.fill("replaced");
    value = await inp.inputValue();
    expect(value).toBe("replaced");
  });
});
