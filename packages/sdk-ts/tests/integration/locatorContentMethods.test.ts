import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Locator content methods (textContent, innerHtml, innerText, inputValue)", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("Locator.textContent() returns raw text including hidden content", async () => {
    const page = await firstPage(stagehand);

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

    const content = await page.locator("#content").textContent();
    // textContent includes all text nodes, even hidden ones
    expect(content).toContain("Hello");
    expect(content).toContain("Hidden");
    expect(content).toContain("World");
  });

  it("Locator.innerText() returns visible text only", async () => {
    const page = await firstPage(stagehand);

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

    const text = await page.locator("#content").innerText();
    // innerText is layout-aware and excludes hidden elements
    expect(text).toContain("Visible");
    expect(text).toContain("Text");
    expect(text).not.toContain("Hidden");
  });

  it("Locator.innerHtml() returns HTML markup", async () => {
    const page = await firstPage(stagehand);

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

    const html = await page.locator("#container").innerHtml();
    expect(html).toContain('<p class="para">Hello</p>');
    expect(html).toContain("<strong>World</strong>");
  });

  it("Locator.inputValue() reads value from input elements", async () => {
    const page = await firstPage(stagehand);

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

    const textValue = await page.locator("#text-input").inputValue();
    expect(textValue).toBe("hello world");

    const taValue = await page.locator("#textarea").inputValue();
    expect(taValue).toBe("multi\nline\ntext");

    const numValue = await page.locator("#number-input").inputValue();
    expect(numValue).toBe("42");
  });

  it("Locator.textContent() on empty elements returns empty string", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="empty"></div>
            <span id="whitespace">   </span>
          </body></html>`,
        ),
    );

    const empty = await page.locator("#empty").textContent();
    expect(empty).toBe("");

    const whitespace = await page.locator("#whitespace").textContent();
    expect(whitespace.trim()).toBe("");
  });

  it("Locator.innerText() with nested elements and formatting", async () => {
    const page = await firstPage(stagehand);

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

    const text = await page.locator("#formatted").innerText();
    expect(text).toContain("Line 1");
    expect(text).toContain("Line 2");
    expect(text).toContain("Item 1");
    expect(text).toContain("Item 2");
  });

  it("Locator.inputValue() on contenteditable elements", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="editable" contenteditable="true">Editable content</div>
          </body></html>`,
        ),
    );

    const value = await page.locator("#editable").inputValue();
    expect(value).toBe("Editable content");
  });

  it("Locator.innerHtml() preserves attributes and structure", async () => {
    const page = await firstPage(stagehand);

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

    const html = await page.locator("#complex").innerHtml();
    expect(html).toContain('href="/link"');
    expect(html).toContain('class="link-class"');
    expect(html).toContain('src="image.png"');
    expect(html).toContain('alt="test"');
  });

  it("Locator.textContent() vs innerText() with script/style tags", async () => {
    const page = await firstPage(stagehand);

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

    const textContent = await page.locator("#mixed").textContent();
    // textContent includes script content
    expect(textContent).toContain("Visible text");
    expect(textContent).toContain("More visible");
    expect(textContent).toContain("console.log");

    const innerText = await page.locator("#mixed").innerText();
    // innerText excludes script/style
    expect(innerText).toContain("Visible text");
    expect(innerText).toContain("More visible");
    expect(innerText).not.toContain("console.log");
  });

  it("Locator.inputValue() returns empty string for non-input elements", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="div">Not an input</div>
            <input id="empty-input" type="text" value="" />
          </body></html>`,
        ),
    );

    const divValue = await page.locator("#div").inputValue();
    expect(divValue).toBe("");

    const emptyInput = await page.locator("#empty-input").inputValue();
    expect(emptyInput).toBe("");
  });
});
