import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Locator content methods (textContent, innerHtml, innerText, inputValue)", () => {
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

  test("Locator.textContent() returns raw text including hidden content", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="content">
              Hello
              <span style="display:none">Hidden</span>
              World
            </div>
          </body></html>`,
        ),
    );

    const content = await page.mainFrame().locator("#content").textContent();
    // textContent includes all text nodes, even hidden ones
    expect(content).toContain("Hello");
    expect(content).toContain("Hidden");
    expect(content).toContain("World");
  });

  test("Locator.innerText() returns visible text only", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="content">
              Visible
              <span style="display:none">Hidden</span>
              Text
            </div>
          </body></html>`,
        ),
    );

    const text = await page.mainFrame().locator("#content").innerText();
    // innerText is layout-aware and excludes hidden elements
    expect(text).toContain("Visible");
    expect(text).toContain("Text");
    expect(text).not.toContain("Hidden");
  });

  test("Locator.innerHtml() returns HTML markup", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="container">
              <p class="para">Hello</p>
              <strong>World</strong>
            </div>
          </body></html>`,
        ),
    );

    const html = await page.mainFrame().locator("#container").innerHtml();
    expect(html).toContain('<p class="para">Hello</p>');
    expect(html).toContain("<strong>World</strong>");
  });

  test("Locator.inputValue() reads value from input elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input id="text-input" type="text" value="hello world" />
            <textarea id="textarea">multi
line
text</textarea>
            <input id="number-input" type="number" value="42" />
          </body></html>`,
        ),
    );

    const textValue = await page
      .mainFrame()
      .locator("#text-input")
      .inputValue();
    expect(textValue).toBe("hello world");

    const taValue = await page.mainFrame().locator("#textarea").inputValue();
    expect(taValue).toBe("multi\nline\ntext");

    const numValue = await page
      .mainFrame()
      .locator("#number-input")
      .inputValue();
    expect(numValue).toBe("42");
  });

  test("Locator.textContent() on empty elements returns empty string", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="empty"></div>
            <span id="whitespace">   </span>
          </body></html>`,
        ),
    );

    const empty = await page.mainFrame().locator("#empty").textContent();
    expect(empty).toBe("");

    const whitespace = await page
      .mainFrame()
      .locator("#whitespace")
      .textContent();
    expect(whitespace.trim()).toBe("");
  });

  test("Locator.innerText() with nested elements and formatting", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="formatted">
              <p>Line 1</p>
              <p>Line 2</p>
              <ul>
                <li>Item 1</li>
                <li>Item 2</li>
              </ul>
            </div>
          </body></html>`,
        ),
    );

    const text = await page.mainFrame().locator("#formatted").innerText();
    expect(text).toContain("Line 1");
    expect(text).toContain("Line 2");
    expect(text).toContain("Item 1");
    expect(text).toContain("Item 2");
  });

  test("Locator.inputValue() on contenteditable elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="editable" contenteditable="true">Editable content</div>
          </body></html>`,
        ),
    );

    const value = await page.mainFrame().locator("#editable").inputValue();
    expect(value).toBe("Editable content");
  });

  test("Locator.innerHtml() preserves attributes and structure", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="complex">
              <a href="/link" class="link-class">Link</a>
              <img src="image.png" alt="test" />
            </div>
          </body></html>`,
        ),
    );

    const html = await page.mainFrame().locator("#complex").innerHtml();
    expect(html).toContain('href="/link"');
    expect(html).toContain('class="link-class"');
    expect(html).toContain('src="image.png"');
    expect(html).toContain('alt="test"');
  });

  test("Locator.textContent() vs innerText() with script/style tags", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="mixed">
              Visible text
              <script>console.log('script');</script>
              <style>body { color: red; }</style>
              More visible
            </div>
          </body></html>`,
        ),
    );

    const textContent = await page.mainFrame().locator("#mixed").textContent();
    // textContent includes script content
    expect(textContent).toContain("Visible text");
    expect(textContent).toContain("More visible");

    const innerText = await page.mainFrame().locator("#mixed").innerText();
    // innerText excludes script/style
    expect(innerText).toContain("Visible text");
    expect(innerText).toContain("More visible");
    expect(innerText).not.toContain("console.log");
  });

  test("Locator.inputValue() returns empty string for non-input elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="div">Not an input</div>
            <input id="empty-input" type="text" value="" />
          </body></html>`,
        ),
    );

    const divValue = await page.mainFrame().locator("#div").inputValue();
    expect(divValue).toBe("");

    const emptyInput = await page
      .mainFrame()
      .locator("#empty-input")
      .inputValue();
    expect(emptyInput).toBe("");
  });
});
