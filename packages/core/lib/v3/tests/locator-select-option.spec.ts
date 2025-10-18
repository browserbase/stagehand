import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Locator.selectOption() method", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch((e) => {
      void e; // ignore cleanup errors
    });
  });

  test("selectOption() selects single option by value", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#fruit");
    const selected = await select.selectOption("banana");

    expect(selected).toEqual(["banana"]);

    const value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("fruit") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("banana");
  });

  test("selectOption() selects option by label/text", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#country");
    const selected = await select.selectOption("United Kingdom");

    expect(selected).toEqual(["uk"]);
  });

  test("selectOption() selects multiple options in multiple select", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#colors");
    const selected = await select.selectOption(["red", "blue"]);

    expect(selected.sort()).toEqual(["blue", "red"]);

    const values = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("colors") as HTMLSelectElement | null;
      return Array.from(s?.selectedOptions ?? []).map((o) => o.value);
    });
    expect(values.sort()).toEqual(["blue", "red"]);
  });

  test("selectOption() deselects previous option on single select", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#size");

    let value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("size") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("m");

    await select.selectOption("l");

    value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("size") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("l");
  });

  test("selectOption() triggers change event", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#opt");
    await select.selectOption("b");

    const output = await page.mainFrame().evaluate(() => {
      const out = document.getElementById("out");
      return out?.textContent;
    });
    expect(output).toBe("changed-b");
  });

  test("selectOption() with optgroup structure", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#grouped");
    await select.selectOption("celery");

    const value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("grouped") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("celery");
  });

  test("selectOption() returns array of selected values", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#multi");
    const selected = await select.selectOption(["1", "3"]);

    expect(selected).toContain("1");
    expect(selected).toContain("3");
    expect(selected.length).toBe(2);
  });

  test("selectOption() with empty string value", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#opt");
    const selected = await select.selectOption("");

    expect(selected).toEqual([""]);

    const value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("opt") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("");
  });

  test("selectOption() with numeric values", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#nums");
    await select.selectOption("10");

    const value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("nums") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("10");
  });

  test("selectOption() with disabled option", async () => {
    const page = v3.context.pages()[0];

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

    const select = page.mainFrame().locator("#mixed");
    // Should still select disabled option if explicitly requested
    await select.selectOption("b");

    const value = await page.mainFrame().evaluate(() => {
      const s = document.getElementById("mixed") as HTMLSelectElement | null;
      return s?.value;
    });
    expect(value).toBe("b");
  });
});
