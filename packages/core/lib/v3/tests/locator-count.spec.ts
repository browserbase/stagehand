import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Locator count() method tests", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("count() returns correct number for CSS selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html,<div class='test'>1</div><div class='test'>2</div><div class='test'>3</div><span>4</span>",
    );

    const locator = page.mainFrame().locator(".test");
    const count = await locator.count();

    expect(count).toBe(3);
  });

  test("count() returns 0 for non-matching selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto("data:text/html,<div>Test</div>");

    const locator = page.mainFrame().locator(".non-existent");
    const count = await locator.count();

    expect(count).toBe(0);
  });

  test("count() works with XPath selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html,<button>Button 1</button><button>Button 2</button><button>Button 3</button>",
    );

    const locator = page.mainFrame().locator("//button");
    const count = await locator.count();

    expect(count).toBe(3);
  });

  test("count() works with text selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html,<div>Click me</div><button>Click me</button><span>Don't click me</span>",
    );

    const locator = page.mainFrame().locator("text=Click me");
    const count = await locator.count();

    // Case-insensitive substring match: also matches "Don't click me"
    expect(count).toBe(3);
  });

  test("count() handles shadow DOM elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="host"></div>' +
            "<script>" +
            'const host = document.getElementById("host");' +
            'const shadow = host.attachShadow({mode: "open"});' +
            'shadow.innerHTML = "<button>1</button><button>2</button>";' +
            "</script>",
        ),
      { waitUntil: "load", timeoutMs: 30000 },
    );

    // Wait a bit for shadow DOM to be attached
    await new Promise((resolve) => setTimeout(resolve, 100));

    const locator = page.mainFrame().locator("button");
    const count = await locator.count();

    expect(count).toBe(2);
  });

  test("count() works with complex CSS selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html,<div class='container'><span class='item'>1</span><span class='item'>2</span></div><div><span class='item'>3</span></div>",
    );

    const locator = page.mainFrame().locator(".container .item");
    const count = await locator.count();

    expect(count).toBe(2);
  });
});
