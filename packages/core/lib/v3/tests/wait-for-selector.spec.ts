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

  test.describe("Basic state tests", () => {
    test("resolves when element is already visible", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<button id="submit-btn">Submit</button>'),
      );

      const result = await page.waitForSelector("#submit-btn");
      expect(result).toBe(true);
    });

    test("resolves when element appears after delay", async () => {
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
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#delayed-btn", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("state 'attached' resolves for hidden elements", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="hidden-div" style="display: none;">Hidden Content</div>',
          ),
      );

      const result = await page.waitForSelector("#hidden-div", {
        state: "attached",
      });
      expect(result).toBe(true);
    });

    test("state 'visible' waits for element to become visible", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="show-later" style="display: none;">Now Visible</div>' +
              "<script>" +
              "setTimeout(() => {" +
              "  document.getElementById('show-later').style.display = 'block';" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#show-later", {
        state: "visible",
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("state 'hidden' waits for element to become hidden", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="hide-later" style="display: block;">Will Hide</div>' +
              "<script>" +
              "setTimeout(() => {" +
              "  document.getElementById('hide-later').style.display = 'none';" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#hide-later", {
        state: "hidden",
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("state 'detached' waits for element to be removed", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="remove-me">Will Be Removed</div>' +
              "<script>" +
              "setTimeout(() => {" +
              "  const el = document.getElementById('remove-me');" +
              "  el.parentNode.removeChild(el);" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#remove-me", {
        state: "detached",
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("state 'detached' resolves immediately for non-existent element", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," + encodeURIComponent("<div>Content</div>"),
      );

      const result = await page.waitForSelector("#does-not-exist", {
        state: "detached",
        timeout: 1000,
      });
      expect(result).toBe(true);
    });
  });

  test.describe("Timeout behavior", () => {
    test("throws on timeout when element never appears", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," + encodeURIComponent("<div>No button here</div>"),
      );

      let error: Error | null = null;
      try {
        await page.waitForSelector("#nonexistent", { timeout: 300 });
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Timeout");
      expect(error?.message).toContain("#nonexistent");
    });

    test("respects custom timeout duration", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," + encodeURIComponent("<div>Content</div>"),
      );

      const startTime = Date.now();
      try {
        await page.waitForSelector("#nonexistent", { timeout: 500 });
      } catch {
        // Expected to timeout
      }
      const elapsed = Date.now() - startTime;

      // Should timeout around 500ms (allow some margin)
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  test.describe("CSS selector variants", () => {
    test("handles complex CSS selectors", async () => {
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

      const result = await page.waitForSelector(
        ".container #login-form button[type='submit']",
      );
      expect(result).toBe(true);
    });
  });

  test.describe("Open shadow DOM", () => {
    test("finds element inside open shadow DOM with pierceShadow: true", async () => {
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
      await page.waitForTimeout(100);

      const result = await page.waitForSelector("#shadow-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("does NOT find shadow DOM element with pierceShadow: false", async () => {
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

      let error: Error | null = null;
      try {
        await page.waitForSelector("#shadow-only-btn", {
          pierceShadow: false,
          timeout: 300,
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Timeout");
    });

    test("finds element in nested open shadow DOM", async () => {
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
  });

  test.describe("Closed shadow DOM (via piercer)", () => {
    test("finds element inside closed shadow DOM via custom element", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<closed-shadow-host></closed-shadow-host>" +
              "<script>" +
              "class ClosedShadowHost extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<button id=\\"closed-btn\\">Closed Shadow Button</button>";' +
              "  }" +
              "}" +
              "customElements.define('closed-shadow-host', ClosedShadowHost);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      // The piercer hooks attachShadow and stores closed shadow roots
      const result = await page.waitForSelector("#closed-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("finds element in nested closed shadow DOM", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<outer-closed></outer-closed>" +
              "<script>" +
              "class InnerClosed extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<span id=\\"deeply-closed\\">Deeply Nested Closed</span>";' +
              "  }" +
              "}" +
              "customElements.define('inner-closed', InnerClosed);" +
              "" +
              "class OuterClosed extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<inner-closed></inner-closed>";' +
              "  }" +
              "}" +
              "customElements.define('outer-closed', OuterClosed);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      const result = await page.waitForSelector("#deeply-closed", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("finds element in mixed open/closed nested shadow DOM", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="open-host"></div>' +
              "<script>" +
              // Inner closed component
              "class ClosedInner extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<button id=\\"mixed-deep-btn\\">Mixed Deep Button</button>";' +
              "  }" +
              "}" +
              "customElements.define('closed-inner', ClosedInner);" +
              // Outer open shadow
              'const openHost = document.getElementById("open-host");' +
              'const openShadow = openHost.attachShadow({mode: "open"});' +
              'openShadow.innerHTML = "<closed-inner></closed-inner>";' +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      const result = await page.waitForSelector("#mixed-deep-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("waits for element to appear inside closed shadow DOM", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<delayed-closed-host></delayed-closed-host>" +
              "<script>" +
              "class DelayedClosedHost extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<div id=\\"container\\"></div>";' +
              "    setTimeout(() => {" +
              '      shadow.getElementById("container").innerHTML = ' +
              '        "<button id=\\"delayed-closed-btn\\">Appeared!</button>";' +
              "    }, 300);" +
              "  }" +
              "}" +
              "customElements.define('delayed-closed-host', DelayedClosedHost);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );

      const result = await page.waitForSelector("#delayed-closed-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  test.describe("XPath selectors", () => {
    test("finds element with basic XPath", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<button id="xpath-btn">XPath Button</button>'),
      );

      const result = await page.waitForSelector("//button[@id='xpath-btn']", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("finds element with xpath= prefix", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="container"><span class="target">Target</span></div>',
          ),
      );

      const result = await page.waitForSelector(
        "xpath=//span[@class='target']",
        {
          timeout: 5000,
        },
      );
      expect(result).toBe(true);
    });

    test("waits for element to appear with XPath", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<div id='container'></div>" +
              "<script>" +
              "setTimeout(() => {" +
              '  document.getElementById("container").innerHTML = ' +
              '    "<span id=\\"delayed-xpath\\">Delayed XPath</span>";' +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("//span[@id='delayed-xpath']", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("finds element in open shadow DOM with XPath", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="host"></div>' +
              "<script>" +
              'const host = document.getElementById("host");' +
              'const shadow = host.attachShadow({mode: "open"});' +
              'shadow.innerHTML = "<button id=\\"shadow-xpath-btn\\">Shadow XPath</button>";' +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      const result = await page.waitForSelector(
        "//button[@id='shadow-xpath-btn']",
        {
          pierceShadow: true,
          timeout: 5000,
        },
      );
      expect(result).toBe(true);
    });

    test("finds element in closed shadow DOM with XPath", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<xpath-closed-host></xpath-closed-host>" +
              "<script>" +
              "class XPathClosedHost extends HTMLElement {" +
              "  constructor() {" +
              "    super();" +
              '    const shadow = this.attachShadow({mode: "closed"});' +
              '    shadow.innerHTML = "<span id=\\"xpath-closed-target\\">Closed XPath Target</span>";' +
              "  }" +
              "}" +
              "customElements.define('xpath-closed-host', XPathClosedHost);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      const result = await page.waitForSelector(
        "//span[@id='xpath-closed-target']",
        {
          pierceShadow: true,
          timeout: 5000,
        },
      );
      expect(result).toBe(true);
    });
  });

  test.describe("Iframe hop notation (>>)", () => {
    test("finds element inside single iframe", async () => {
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

      const result = await page.waitForSelector(
        "iframe#my-frame >> #frame-btn",
        {
          timeout: 5000,
        },
      );
      expect(result).toBe(true);
    });

    test("finds element through multiple iframe hops", async () => {
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

    test("waits for element to appear inside iframe", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<iframe id="delay-frame"></iframe>' +
              "<script>" +
              'const frame = document.getElementById("delay-frame");' +
              "const doc = frame.contentDocument;" +
              "doc.open();" +
              'doc.write("<div id=\\"container\\"></div>");' +
              "doc.close();" +
              "setTimeout(() => {" +
              '  doc.getElementById("container").innerHTML = ' +
              '    "<span id=\\"delayed-in-frame\\">Appeared!</span>";' +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector(
        "iframe#delay-frame >> #delayed-in-frame",
        {
          timeout: 5000,
        },
      );
      expect(result).toBe(true);
    });
  });

  test.describe("Visibility edge cases", () => {
    test("visibility: hidden is not visible", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="vis-hidden" style="visibility: hidden;">Hidden</div>',
          ),
      );

      // Should be attached but not visible
      const attached = await page.waitForSelector("#vis-hidden", {
        state: "attached",
      });
      expect(attached).toBe(true);

      let error: Error | null = null;
      try {
        await page.waitForSelector("#vis-hidden", {
          state: "visible",
          timeout: 200,
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).not.toBeNull();
    });

    test("opacity: 0 is not visible", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="transparent" style="opacity: 0;">Transparent</div>',
          ),
      );

      const attached = await page.waitForSelector("#transparent", {
        state: "attached",
      });
      expect(attached).toBe(true);

      let error: Error | null = null;
      try {
        await page.waitForSelector("#transparent", {
          state: "visible",
          timeout: 200,
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).not.toBeNull();
    });

    test("zero dimensions is not visible", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="zero-size" style="width: 0; height: 0;">Zero</div>',
          ),
      );

      const attached = await page.waitForSelector("#zero-size", {
        state: "attached",
      });
      expect(attached).toBe(true);

      let error: Error | null = null;
      try {
        await page.waitForSelector("#zero-size", {
          state: "visible",
          timeout: 200,
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).not.toBeNull();
    });

    test("detects visibility change via class toggle", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<style>.hidden { display: none; }</style>" +
              '<div id="class-toggle" class="hidden">Class Toggle</div>' +
              "<script>" +
              "setTimeout(() => {" +
              "  document.getElementById('class-toggle').classList.remove('hidden');" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#class-toggle", {
        state: "visible",
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("detects visibility change via style attribute", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="style-toggle" style="display: none;">Style Toggle</div>' +
              "<script>" +
              "setTimeout(() => {" +
              "  document.getElementById('style-toggle').style.display = 'block';" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#style-toggle", {
        state: "visible",
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  test.describe("Dynamic DOM scenarios", () => {
    test("handles rapid DOM mutations", async () => {
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
              "  div.textContent = 'item';" +
              "  document.getElementById('container').appendChild(div);" +
              "  if (count >= 10) clearInterval(interval);" +
              "}, 50);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      // Small delay to ensure script starts
      await page.waitForTimeout(50);

      const result = await page.waitForSelector("#item-7", { timeout: 10000 });
      expect(result).toBe(true);
    });

    test("handles element removed and re-added", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="toggle-me">Toggle</div>' +
              "<script>" +
              "const el = document.getElementById('toggle-me');" +
              "const parent = el.parentNode;" +
              "setTimeout(() => { parent.removeChild(el); }, 200);" +
              "setTimeout(() => { parent.appendChild(el); }, 500);" +
              "</script>",
          ),
      );

      // First wait for detached
      const detached = await page.waitForSelector("#toggle-me", {
        state: "detached",
        timeout: 5000,
      });
      expect(detached).toBe(true);

      // Then wait for visible again
      const visible = await page.waitForSelector("#toggle-me", {
        state: "visible",
        timeout: 5000,
      });
      expect(visible).toBe(true);
    });

    test("handles dynamically replaced innerHTML", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="container">Loading...</div>' +
              "<script>" +
              "setTimeout(() => {" +
              '  document.getElementById("container").innerHTML = ' +
              '    "<button id=\\"loaded-btn\\">Loaded!</button>";' +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#loaded-btn", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("handles element created via insertAdjacentHTML", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="anchor"></div>' +
              "<script>" +
              "setTimeout(() => {" +
              '  document.getElementById("anchor").insertAdjacentHTML(' +
              '    "afterend", "<div id=\\"inserted\\">Inserted</div>"' +
              "  );" +
              "}, 300);" +
              "</script>",
          ),
      );

      const result = await page.waitForSelector("#inserted", { timeout: 5000 });
      expect(result).toBe(true);
    });
  });

  test.describe("Shadow DOM visibility changes", () => {
    test("detects element becoming visible inside open shadow DOM", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="host"></div>' +
              "<script>" +
              'const host = document.getElementById("host");' +
              'const shadow = host.attachShadow({mode: "open"});' +
              'shadow.innerHTML = "<button id=\\"shadow-btn\\" style=\\"display:none\\">Shadow</button>";' +
              "setTimeout(() => {" +
              '  shadow.getElementById("shadow-btn").style.display = "block";' +
              "}, 300);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );

      const result = await page.waitForSelector("#shadow-btn", {
        state: "visible",
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    test("detects element becoming hidden inside shadow DOM", async () => {
      const page = v3.context.pages()[0];
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<div id="host"></div>' +
              "<script>" +
              'const host = document.getElementById("host");' +
              'const shadow = host.attachShadow({mode: "open"});' +
              'shadow.innerHTML = "<button id=\\"hide-shadow-btn\\">Will Hide</button>";' +
              "setTimeout(() => {" +
              '  shadow.getElementById("hide-shadow-btn").style.display = "none";' +
              "}, 300);" +
              "</script>",
          ),
        { waitUntil: "load", timeoutMs: 30000 },
      );
      await page.waitForTimeout(100);

      const result = await page.waitForSelector("#hide-shadow-btn", {
        state: "hidden",
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });
});
