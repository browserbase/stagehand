import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Locator.selectOption() method", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("selectOption() selects single option by value", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="fruit">
              <option value="">-- Choose --</option>
              <option value="apple">Apple</option>
              <option value="banana">Banana</option>
              <option value="cherry">Cherry</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#fruit");
    const selected = await select.selectOption("banana");

    expect(selected).toEqual(["banana"]);

    const value = await page.evaluate(() => {
      const s = document.getElementById("fruit") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("banana");
  });

  it("selectOption() selects option by label/text", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="country">
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
              <option value="ca">Canada</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#country");
    const selected = await select.selectOption("United Kingdom");

    expect(selected).toEqual(["uk"]);
  });

  it("selectOption() selects multiple options in multiple select", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="colors" multiple>
              <option value="red">Red</option>
              <option value="green">Green</option>
              <option value="blue">Blue</option>
              <option value="yellow">Yellow</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#colors");
    const selected = await select.selectOption(["red", "blue"]);

    expect(selected.sort()).toEqual(["blue", "red"]);

    const values = await page.evaluate(() => {
      const s = document.getElementById("colors") as HTMLSelectElement | null;
      return Array.from(s?.selectedOptions ?? []).map((o) => o.value);
    });
    expect(values.sort()).toEqual(["blue", "red"]);
  });

  it("selectOption() deselects previous option on single select", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="size">
              <option value="s">Small</option>
              <option value="m" selected>Medium</option>
              <option value="l">Large</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#size");

    let value = await page.evaluate(() => {
      const s = document.getElementById("size") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("m");

    await select.selectOption("l");

    value = await page.evaluate(() => {
      const s = document.getElementById("size") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("l");
  });

  it("selectOption() triggers change event", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="opt">
              <option value="a">Option A</option>
              <option value="b">Option B</option>
            </select>
            <div id="out"></div>
            <script>
              const select = document.getElementById('opt');
              const out = document.getElementById('out');
              select.addEventListener('change', () => {
                out.textContent = 'changed-' + select.value;
              });
            </script>
          </body></html>`,
        ),
    );

    const select = page.locator("#opt");
    await select.selectOption("b");

    const output = await page.evaluate(() => {
      const out = document.getElementById("out");
      return out?.textContent;
    });
    expect(output).toBe("changed-b");
  });

  it("selectOption() with optgroup structure", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="grouped">
              <optgroup label="Fruits">
                <option value="apple">Apple</option>
                <option value="orange">Orange</option>
              </optgroup>
              <optgroup label="Vegetables">
                <option value="carrot">Carrot</option>
                <option value="celery">Celery</option>
              </optgroup>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#grouped");
    await select.selectOption("celery");

    const value = await page.evaluate(() => {
      const s = document.getElementById("grouped") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("celery");
  });

  it("selectOption() returns array of selected values", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="multi" multiple>
              <option value="1">One</option>
              <option value="2">Two</option>
              <option value="3">Three</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#multi");
    const selected = await select.selectOption(["1", "3"]);

    expect(selected).toContain("1");
    expect(selected).toContain("3");
    expect(selected.length).toBe(2);
  });

  it("selectOption() with empty string value", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="opt">
              <option value="">None</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#opt");
    const selected = await select.selectOption("");

    expect(selected).toEqual([""]);

    const value = await page.evaluate(() => {
      const s = document.getElementById("opt") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("");
  });

  it("selectOption() with numeric values", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="nums">
              <option value="1">One</option>
              <option value="2">Two</option>
              <option value="10">Ten</option>
              <option value="100">Hundred</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#nums");
    await select.selectOption("10");

    const value = await page.evaluate(() => {
      const s = document.getElementById("nums") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("10");
  });

  it("selectOption() with disabled option", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <select id="mixed">
              <option value="a">Available</option>
              <option value="b" disabled>Unavailable</option>
              <option value="c">Available</option>
            </select>
          </body></html>`,
        ),
    );

    const select = page.locator("#mixed");
    // Should still select disabled option if explicitly requested
    await select.selectOption("b");

    const value = await page.evaluate(() => {
      const s = document.getElementById("mixed") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("b");
  });
});
