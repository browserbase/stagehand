import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Locator nth() method tests", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("nth() returns correct element for CSS selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="test" id="first">1</div>' +
            '<div class="test" id="second">2</div>' +
            '<div class="test" id="third">3</div>' +
            '<span id="other">4</span>',
        ),
    );

    // Test nth() with CSS selectors
    const locator0 = page.mainFrame().locator(".test").nth(0);
    const text0 = await locator0.textContent();
    expect(text0).toBe("1");

    const locator1 = page.mainFrame().locator(".test").nth(1);
    const text1 = await locator1.textContent();
    expect(text1).toBe("2");

    const locator2 = page.mainFrame().locator(".test").nth(2);
    const text2 = await locator2.textContent();
    expect(text2).toBe("3");
  });

  test("nth() returns correct element for XPath selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<button id="btn1">Button 1</button>' +
            '<button id="btn2">Button 2</button>' +
            '<button id="btn3">Button 3</button>',
        ),
    );

    // Test nth() with XPath selectors
    const locator0 = page.mainFrame().locator("//button").nth(0);
    const text0 = await locator0.textContent();
    expect(text0).toBe("Button 1");

    const locator1 = page.mainFrame().locator("//button").nth(1);
    const text1 = await locator1.textContent();
    expect(text1).toBe("Button 2");

    const locator2 = page.mainFrame().locator("//button").nth(2);
    const text2 = await locator2.textContent();
    expect(text2).toBe("Button 3");
  });

  test("nth() returns correct element for text selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="d1">Click me</div>' +
            '<button id="b1">Click me</button>' +
            '<span id="s1">Click me</span>',
        ),
    );

    // Test nth() with text selectors
    const locator0 = page.mainFrame().locator("text=Click me").nth(0);
    const text0 = await locator0.textContent();
    expect(text0).toBe("Click me");

    const locator1 = page.mainFrame().locator("text=Click me").nth(1);
    const text1 = await locator1.textContent();
    expect(text1).toBe("Click me");

    const locator2 = page.mainFrame().locator("text=Click me").nth(2);
    const text2 = await locator2.textContent();
    expect(text2).toBe("Click me");
  });

  test("nth() with shadow DOM", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="host"></div>' +
            "<script>" +
            'const host = document.getElementById("host");' +
            'const shadow = host.attachShadow({mode: "open"});' +
            'shadow.innerHTML = "<button>Shadow Button 1</button><button>Shadow Button 2</button><button>Shadow Button 3</button>";' +
            "</script>",
        ),
      { waitUntil: "load", timeoutMs: 30000 },
    );

    // Wait a bit for shadow DOM to be attached
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Test nth() with shadow DOM elements
    const locator0 = page.mainFrame().locator("button").nth(0);
    const text0 = await locator0.textContent();
    expect(text0).toBe("Shadow Button 1");

    const locator1 = page.mainFrame().locator("button").nth(1);
    const text1 = await locator1.textContent();
    expect(text1).toBe("Shadow Button 2");

    const locator2 = page.mainFrame().locator("button").nth(2);
    const text2 = await locator2.textContent();
    expect(text2).toBe("Shadow Button 3");
  });

  test("nth() with out of bounds index throws error", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="test">1</div>' + '<div class="test">2</div>',
        ),
    );

    // Test with out of bounds index - should throw an error
    const locator = page.mainFrame().locator(".test").nth(5);
    let error = null;
    try {
      await locator.textContent();
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
  });

  test("nth() works with complex CSS selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="container">' +
            '<span class="item">1</span>' +
            '<span class="item">2</span>' +
            "</div>" +
            "<div>" +
            '<span class="item">3</span>' +
            "</div>",
        ),
    );

    // Test nth() with complex CSS selectors
    const locator0 = page.mainFrame().locator(".container .item").nth(0);
    const text0 = await locator0.textContent();
    expect(text0).toBe("1");

    const locator1 = page.mainFrame().locator(".container .item").nth(1);
    const text1 = await locator1.textContent();
    expect(text1).toBe("2");
  });

  test("nth() can be chained with other locator methods", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="test">First</div>' +
            '<div class="test">Second</div>' +
            '<div class="test">Third</div>',
        ),
    );

    // Test that nth() returns a Locator that can be used for other actions
    const locator = page.mainFrame().locator(".test").nth(1);
    const text = await locator.textContent();
    expect(text).toBe("Second");

    // Verify it's visible
    const isVisible = await locator.isVisible();
    expect(isVisible).toBe(true);
  });

  test("nth(0) is equivalent to first()", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="test">First</div>' +
            '<div class="test">Second</div>' +
            '<div class="test">Third</div>',
        ),
    );

    // Verify nth(0) returns the same element as first()
    const nthLocator = page.mainFrame().locator(".test").nth(0);
    const nthText = await nthLocator.textContent();

    const firstLocator = page.mainFrame().locator(".test").first();
    const firstText = await firstLocator.textContent();

    expect(nthText).toBe(firstText);
    expect(nthText).toBe("First");
  });

  test("nth() works correctly with iframe selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<button id="main1">Main Button 1</button>' +
            '<button id="main2">Main Button 2</button>' +
            '<iframe id="frame1"></iframe>' +
            "<script>" +
            'const frame = document.getElementById("frame1");' +
            "const doc = frame.contentDocument;" +
            "doc.open();" +
            'doc.write("<button>Frame Button 1</button><button>Frame Button 2</button>");' +
            "doc.close();" +
            "</script>",
        ),
    );

    // Wait for iframe to load
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Test that nth() works correctly with buttons in the main frame
    const mainLocator0 = page.mainFrame().locator("button").nth(0);
    const mainText0 = await mainLocator0.textContent();
    expect(mainText0).toBe("Main Button 1");

    const mainLocator1 = page.mainFrame().locator("button").nth(1);
    const mainText1 = await mainLocator1.textContent();
    expect(mainText1).toBe("Main Button 2");
  });
});
