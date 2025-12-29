import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Page.waitForSelector tests", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("waitForSelector resolves when element is already visible", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<button id="submit-btn">Submit</button>',
        ),
    );

    const result = await page.waitForSelector("#submit-btn");
    expect(result).toBe(true);
  });

  test("waitForSelector resolves when element appears after delay", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<div id='container'></div>" +
            "<script>" +
            "setTimeout(() => {" +
            "  const btn = document.createElement('button');" +
            "  btn.id = 'delayed-btn';" +
            "  btn.textContent = 'Delayed Button';" +
            "  document.getElementById('container').appendChild(btn);" +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#delayed-btn", { timeout: 5000 });
    expect(result).toBe(true);
  });

  test("waitForSelector with state 'attached' resolves for hidden elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="hidden-div" style="display: none;">Hidden Content</div>',
        ),
    );

    // Should resolve because element is attached to DOM (even though hidden)
    const result = await page.waitForSelector("#hidden-div", { state: "attached" });
    expect(result).toBe(true);
  });

  test("waitForSelector with state 'visible' waits for element to become visible", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="show-later" style="display: none;">Now Visible</div>' +
            "<script>" +
            "setTimeout(() => {" +
            "  document.getElementById('show-later').style.display = 'block';" +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#show-later", {
      state: "visible",
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector with state 'hidden' waits for element to become hidden", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="hide-later" style="display: block;">Will Hide</div>' +
            "<script>" +
            "setTimeout(() => {" +
            "  document.getElementById('hide-later').style.display = 'none';" +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#hide-later", {
      state: "hidden",
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector with state 'detached' waits for element to be removed", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="remove-me">Will Be Removed</div>' +
            "<script>" +
            "setTimeout(() => {" +
            "  const el = document.getElementById('remove-me');" +
            "  el.parentNode.removeChild(el);" +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#remove-me", {
      state: "detached",
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector throws on timeout when element never appears", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent("<div>No button here</div>"),
    );

    let error: Error | null = null;
    try {
      await page.waitForSelector("#nonexistent", { timeout: 500 });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Timeout");
    expect(error?.message).toContain("#nonexistent");
  });

  test("waitForSelector works with CSS class selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="my-class">Content</div>',
        ),
    );

    const result = await page.waitForSelector(".my-class");
    expect(result).toBe(true);
  });

  test("waitForSelector works with attribute selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<input type="email" data-testid="email-input" />',
        ),
    );

    const result = await page.waitForSelector('[data-testid="email-input"]');
    expect(result).toBe(true);
  });

  test("waitForSelector works with complex CSS selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="container">' +
            '<form id="login-form">' +
            '<button type="submit">Login</button>' +
            "</form>" +
            "</div>",
        ),
    );

    const result = await page.waitForSelector(".container #login-form button[type='submit']");
    expect(result).toBe(true);
  });

  test("waitForSelector with shadow DOM piercing", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="host"></div>' +
            "<script>" +
            'const host = document.getElementById("host");' +
            'const shadow = host.attachShadow({mode: "open"});' +
            'shadow.innerHTML = "<button id=\\"shadow-btn\\">Shadow Button</button>";' +
            "</script>",
        ),
      { waitUntil: "load", timeoutMs: 30000 },
    );

    // Wait for shadow DOM to be attached
    await page.waitForTimeout(100);

    // Should find element inside shadow DOM with pierceShadow: true (default)
    const result = await page.waitForSelector("#shadow-btn", {
      pierceShadow: true,
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector with pierceShadow false does not find shadow DOM elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="host"></div>' +
            "<script>" +
            'const host = document.getElementById("host");' +
            'const shadow = host.attachShadow({mode: "open"});' +
            'shadow.innerHTML = "<button id=\\"shadow-only-btn\\">Shadow Only</button>";' +
            "</script>",
        ),
      { waitUntil: "load", timeoutMs: 30000 },
    );

    await page.waitForTimeout(100);

    // Should NOT find element inside shadow DOM with pierceShadow: false
    let error: Error | null = null;
    try {
      await page.waitForSelector("#shadow-only-btn", {
        pierceShadow: false,
        timeout: 500,
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Timeout");
  });

  test("waitForSelector with nested shadow DOM", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="outer-host"></div>' +
            "<script>" +
            'const outerHost = document.getElementById("outer-host");' +
            'const outerShadow = outerHost.attachShadow({mode: "open"});' +
            'outerShadow.innerHTML = "<div id=\\"inner-host\\"></div>";' +
            'const innerHost = outerShadow.getElementById("inner-host");' +
            'const innerShadow = innerHost.attachShadow({mode: "open"});' +
            'innerShadow.innerHTML = "<span id=\\"deep-element\\">Deep!</span>";' +
            "</script>",
        ),
      { waitUntil: "load", timeoutMs: 30000 },
    );

    await page.waitForTimeout(100);

    const result = await page.waitForSelector("#deep-element", {
      pierceShadow: true,
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector with iframe hop notation (>>)", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<button id="main-btn">Main Button</button>' +
            '<iframe id="my-frame"></iframe>' +
            "<script>" +
            'const frame = document.getElementById("my-frame");' +
            "const doc = frame.contentDocument;" +
            "doc.open();" +
            'doc.write("<button id=\\"frame-btn\\">Frame Button</button>");' +
            "doc.close();" +
            "</script>",
        ),
    );

    await page.waitForTimeout(100);

    // Use >> notation to hop into iframe
    const result = await page.waitForSelector("iframe#my-frame >> #frame-btn", {
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector with multiple iframe hops", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<iframe id="outer-frame"></iframe>' +
            "<script>" +
            'const outerFrame = document.getElementById("outer-frame");' +
            "const outerDoc = outerFrame.contentDocument;" +
            "outerDoc.open();" +
            'outerDoc.write("<iframe id=\\"inner-frame\\"></iframe>");' +
            "outerDoc.close();" +
            "setTimeout(() => {" +
            '  const innerFrame = outerDoc.getElementById("inner-frame");' +
            "  const innerDoc = innerFrame.contentDocument;" +
            "  innerDoc.open();" +
            '  innerDoc.write("<div id=\\"nested-content\\">Deeply Nested</div>");' +
            "  innerDoc.close();" +
            "}, 100);" +
            "</script>",
        ),
    );

    await page.waitForTimeout(300);

    const result = await page.waitForSelector(
      "iframe#outer-frame >> iframe#inner-frame >> #nested-content",
      { timeout: 5000 },
    );
    expect(result).toBe(true);
  });

  test("waitForSelector with visibility hidden vs display none", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="vis-hidden" style="visibility: hidden;">Visibility Hidden</div>' +
            '<div id="disp-none" style="display: none;">Display None</div>',
        ),
    );

    // Both should be found with 'attached' state
    const attached1 = await page.waitForSelector("#vis-hidden", { state: "attached" });
    const attached2 = await page.waitForSelector("#disp-none", { state: "attached" });
    expect(attached1).toBe(true);
    expect(attached2).toBe(true);

    // Neither should be found with 'visible' state (within timeout)
    let error1: Error | null = null;
    try {
      await page.waitForSelector("#vis-hidden", { state: "visible", timeout: 200 });
    } catch (e) {
      error1 = e as Error;
    }
    expect(error1).not.toBeNull();

    let error2: Error | null = null;
    try {
      await page.waitForSelector("#disp-none", { state: "visible", timeout: 200 });
    } catch (e) {
      error2 = e as Error;
    }
    expect(error2).not.toBeNull();
  });

  test("waitForSelector with opacity 0", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="transparent" style="opacity: 0;">Transparent</div>',
        ),
    );

    // Should be found with 'attached' state
    const attached = await page.waitForSelector("#transparent", { state: "attached" });
    expect(attached).toBe(true);

    // Should NOT be found with 'visible' state
    let error: Error | null = null;
    try {
      await page.waitForSelector("#transparent", { state: "visible", timeout: 200 });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
  });

  test("waitForSelector with zero dimensions", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="zero-size" style="width: 0; height: 0;">Zero Size</div>',
        ),
    );

    // Should be found with 'attached' state
    const attached = await page.waitForSelector("#zero-size", { state: "attached" });
    expect(attached).toBe(true);

    // Should NOT be found with 'visible' state (zero dimensions)
    let error: Error | null = null;
    try {
      await page.waitForSelector("#zero-size", { state: "visible", timeout: 200 });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
  });

  test("waitForSelector detects element becoming visible via class change", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<style>.hidden { display: none; }</style>" +
            '<div id="class-toggle" class="hidden">Class Toggle</div>' +
            "<script>" +
            "setTimeout(() => {" +
            "  document.getElementById('class-toggle').classList.remove('hidden');" +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#class-toggle", {
      state: "visible",
      timeout: 5000,
    });
    expect(result).toBe(true);
  });

  test("waitForSelector handles rapid DOM mutations", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<div id='container'></div>" +
            "<script>" +
            "let count = 0;" +
            "const interval = setInterval(() => {" +
            "  count++;" +
            "  const div = document.createElement('div');" +
            "  div.id = 'item-' + count;" +
            "  div.textContent = 'Item ' + count;" +
            "  document.getElementById('container').appendChild(div);" +
            "  if (count >= 10) clearInterval(interval);" +
            "}, 50);" +
            "</script>",
        ),
    );

    // Wait for the 7th item to appear
    const result = await page.waitForSelector("#item-7", { timeout: 5000 });
    expect(result).toBe(true);
  });

  test("waitForSelector with default timeout", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent("<div id='existing'>Existing</div>"),
    );

    // Should use default timeout (30000ms) and resolve immediately for existing element
    const result = await page.waitForSelector("#existing");
    expect(result).toBe(true);
  });

  test("waitForSelector with tag name selector", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          "<article>Article Content</article>",
        ),
    );

    const result = await page.waitForSelector("article");
    expect(result).toBe(true);
  });

  test("waitForSelector with :first-child pseudo selector", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<ul><li id="first">First</li><li id="second">Second</li></ul>',
        ),
    );

    const result = await page.waitForSelector("li:first-child");
    expect(result).toBe(true);
  });

  test("waitForSelector with :not() pseudo selector", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div class="item active">Active</div>' +
            '<div class="item">Inactive</div>',
        ),
    );

    const result = await page.waitForSelector(".item:not(.active)");
    expect(result).toBe(true);
  });

  test("waitForSelector for dynamically loaded content", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="loading">Loading...</div>' +
            "<script>" +
            "setTimeout(() => {" +
            "  document.getElementById('loading').innerHTML = " +
            '    \'<div id="loaded-content">Content Loaded!</div>\';' +
            "}, 500);" +
            "</script>",
        ),
    );

    const result = await page.waitForSelector("#loaded-content", { timeout: 5000 });
    expect(result).toBe(true);
  });

  test("waitForSelector for element removed and re-added", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="toggle-me">Toggle Element</div>' +
            "<script>" +
            "const el = document.getElementById('toggle-me');" +
            "const parent = el.parentNode;" +
            "setTimeout(() => { parent.removeChild(el); }, 200);" +
            "setTimeout(() => { parent.appendChild(el); }, 600);" +
            "</script>",
        ),
    );

    // First wait for it to be detached
    const detached = await page.waitForSelector("#toggle-me", {
      state: "detached",
      timeout: 5000,
    });
    expect(detached).toBe(true);

    // Then wait for it to be visible again
    const visible = await page.waitForSelector("#toggle-me", {
      state: "visible",
      timeout: 5000,
    });
    expect(visible).toBe(true);
  });
});

