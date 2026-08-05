import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";
describe("Page.waitForSelector tests", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;

  const fixtureUrl = (html: string) => `${fixture.url}?html=${encodeURIComponent(html)}`;

  beforeAll(async () => {
    fixture = await startFixtureServer((request) => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      return url.searchParams.get("html") ?? "";
    });
    stagehand = await createStagehand();
  });

  beforeEach(async () => {
    const pages = await stagehand.browser.context.pages();
    if (pages.length === 0) {
      await stagehand.browser.context.newPage({ url: "about:blank" });
      return;
    }

    const [primary, ...extras] = pages;
    for (const page of extras) {
      await page.close().catch(() => {});
    }

    await stagehand.browser.context.setActivePage(primary);
    await primary.goto("about:blank", {
      waitUntil: "load",
      timeout: 15_000,
    });
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  describe("Basic state tests", () => {
    it("resolves when element is already visible", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," + encodeURIComponent('<button id="submit-btn">Submit</button>'),
      );

      const result = await page.waitForSelector("#submit-btn");
      expect(result).toBe(true);
    });

    it("resolves when element appears after delay", async () => {
      const page = await firstPage(stagehand);
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

    it("state 'attached' resolves for hidden elements", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<div id="hidden-div" style="display: none;">Hidden Content</div>'),
      );

      const result = await page.waitForSelector("#hidden-div", {
        state: "attached",
      });
      expect(result).toBe(true);
    });

    it("state 'visible' waits for element to become visible", async () => {
      const page = await firstPage(stagehand);
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

    it("state 'hidden' waits for element to become hidden", async () => {
      const page = await firstPage(stagehand);
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

    it("state 'detached' waits for element to be removed", async () => {
      const page = await firstPage(stagehand);
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

    it("state 'detached' resolves immediately for non-existent element", async () => {
      const page = await firstPage(stagehand);
      await page.goto("data:text/html," + encodeURIComponent("<div>Content</div>"));

      const result = await page.waitForSelector("#does-not-exist", {
        state: "detached",
        timeout: 1000,
      });
      expect(result).toBe(true);
    });
  });

  describe("Timeout behavior", () => {
    it("throws on timeout when element never appears", async () => {
      const page = await firstPage(stagehand);
      await page.goto("data:text/html," + encodeURIComponent("<div>No button here</div>"));

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

    it("respects custom timeout duration", async () => {
      const page = await firstPage(stagehand);
      await page.goto("data:text/html," + encodeURIComponent("<div>Content</div>"));

      const startTime = Date.now();
      try {
        await page.waitForSelector("#nonexistent", { timeout: 500 });
      } catch {
        // Expected to timeout
      }
      const elapsed = Date.now() - startTime;

      // The operation must not return before its configured deadline. There is no upper wall-clock
      // bound because scheduler contention is not part of the API contract.
      expect(elapsed).toBeGreaterThanOrEqual(450);
    });
  });

  describe("CSS selector variants", () => {
    it("handles complex CSS selectors", async () => {
      const page = await firstPage(stagehand);
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
  });

  describe("Open shadow DOM", () => {
    it("finds element inside open shadow DOM with pierceShadow: true", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#shadow-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("does NOT find shadow DOM element with pierceShadow: false", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

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

    it("finds element in nested open shadow DOM", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#deep-element", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  describe("Closed shadow DOM (via piercer)", () => {
    it("finds element inside closed shadow DOM via custom element", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        fixtureUrl(
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#closed-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("finds element in nested closed shadow DOM", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        fixtureUrl(
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#deeply-closed", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("finds element in mixed open/closed nested shadow DOM", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        fixtureUrl(
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#mixed-deep-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("waits for element to appear inside closed shadow DOM", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        fixtureUrl(
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#delayed-closed-btn", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  describe("XPath selectors", () => {
    it("finds element with basic XPath", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," + encodeURIComponent('<button id="xpath-btn">XPath Button</button>'),
      );

      const result = await page.waitForSelector("//button[@id='xpath-btn']", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("finds element with xpath= prefix", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<div id="container"><span class="target">Target</span></div>'),
      );

      const result = await page.waitForSelector("xpath=//span[@class='target']", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("waits for element to appear with XPath", async () => {
      const page = await firstPage(stagehand);
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

    it("finds element in open shadow DOM with XPath", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("//button[@id='shadow-xpath-btn']", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("finds element in closed shadow DOM with XPath", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        fixtureUrl(
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("//span[@id='xpath-closed-target']", {
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  describe("Iframe hop notation (>>)", () => {
    it("finds element inside single iframe", async () => {
      const page = await firstPage(stagehand);
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

      const result = await page.waitForSelector("iframe#my-frame >> #frame-btn", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("finds element through multiple iframe hops", async () => {
      const page = await firstPage(stagehand);
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

      const result = await page.waitForSelector(
        "iframe#outer-frame >> iframe#inner-frame >> #nested-content",
        { timeout: 5000 },
      );
      expect(result).toBe(true);
    });

    it("waits for element to appear inside iframe", async () => {
      const page = await firstPage(stagehand);
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

      const result = await page.waitForSelector("iframe#delay-frame >> #delayed-in-frame", {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });

  describe("Visibility edge cases", () => {
    it("visibility: hidden is not visible", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<div id="vis-hidden" style="visibility: hidden;">Hidden</div>'),
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

    it("opacity: 0 is not visible", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<div id="transparent" style="opacity: 0;">Transparent</div>'),
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

    it("zero dimensions is not visible", async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent('<div id="zero-size" style="width: 0; height: 0;">Zero</div>'),
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

    it("detects visibility change via class toggle", async () => {
      const page = await firstPage(stagehand);
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

    it("detects visibility change via style attribute", async () => {
      const page = await firstPage(stagehand);
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

  describe("Dynamic DOM scenarios", () => {
    it("handles rapid DOM mutations", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );
      // Small delay to ensure script starts
      await page.waitForTimeout(50);

      const result = await page.waitForSelector("#item-7", { timeout: 10000 });
      expect(result).toBe(true);
    });

    it("handles element removed and re-added", async () => {
      const page = await firstPage(stagehand);
      await page.goto("data:text/html," + encodeURIComponent('<div id="toggle-me">Toggle</div>'));

      await page.evaluate(() => {
        setTimeout(() => document.getElementById("toggle-me")?.remove(), 200);
      });
      const detached = await page.waitForSelector("#toggle-me", {
        state: "detached",
        timeout: 5000,
      });
      expect(detached).toBe(true);

      await page.evaluate(() => {
        setTimeout(() => {
          const element = document.createElement("div");
          element.id = "toggle-me";
          element.textContent = "Toggle";
          document.body.appendChild(element);
        }, 200);
      });
      const visible = await page.waitForSelector("#toggle-me", {
        state: "visible",
        timeout: 5000,
      });
      expect(visible).toBe(true);
    });

    it("handles dynamically replaced innerHTML", async () => {
      const page = await firstPage(stagehand);
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

    it("handles element created via insertAdjacentHTML", async () => {
      const page = await firstPage(stagehand);
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

  describe("Shadow DOM visibility changes", () => {
    it("detects element becoming visible inside open shadow DOM", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#shadow-btn", {
        state: "visible",
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it("detects element becoming hidden inside shadow DOM", async () => {
      const page = await firstPage(stagehand);
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
        { waitUntil: "load", timeout: 30000 },
      );

      const result = await page.waitForSelector("#hide-shadow-btn", {
        state: "hidden",
        pierceShadow: true,
        timeout: 5000,
      });
      expect(result).toBe(true);
    });
  });
});
