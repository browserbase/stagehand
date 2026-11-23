import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@browserbasehq/stagehand-browser-api/page";
import type {
  LocatorChain,
  LocatorNthStep,
  LocatorQueryStep,
} from "@browserbasehq/stagehand-protocol/types";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import type { StagehandBrowser } from "../../src/browser/index.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const extensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));
const css = (value: string): LocatorQueryStep => ({
  type: "query",
  selector: { kind: "css", value },
});
const xpath = (value: string): LocatorQueryStep => ({
  type: "query",
  selector: { kind: "xpath", value },
});
const text = (value: string): LocatorQueryStep => ({
  type: "query",
  selector: { kind: "text", value },
});
const nth = (index: number): LocatorNthStep => ({ type: "nth", index });

describe("element chain resolution in the browser", () => {
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  let page: Page;

  beforeAll(async () => {
    chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(60_000));
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async (options) =>
        CDPClient.connect({ ...options, localExtensionDir: extensionDir }),
    });
    browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
    page = await browser.context.newPage();
  }, 60_000);

  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      try {
        await browser?.disconnect();
      } finally {
        await chrome?.close();
      }
    }
  });

  // This extension page exposes the real registry and chrome.dom accessor in
  // its main world, including access to roots created with mode: "closed".
  const evaluate = (body: string) =>
    page.evaluate(`(() => {
    const scripts = globalThis.__stagehandLocatorScripts;
    const ids = nodes => nodes.map(node => node.id);
    ${body}
  })()`);
  const resolve = (...steps: LocatorChain["steps"]) =>
    evaluate(`return ids(scripts.resolveElementChain(${JSON.stringify({ steps })}));`);

  beforeEach(async () => {
    await page.evaluate(`document.body.innerHTML =
      '<main id="cards">' +
        '<section class="card" id="card-a"><button id="a">Save</button>' +
          '<div class="nested" id="inner"><button id="a-deep">Save now</button></div></section>' +
        '<section class="card" id="card-b"><button id="b">Save</button></section>' +
      '</main><button id="outside">Save</button>'`);
  });

  it("applies indices at their position and retains all intermediate matches", async () => {
    expect(await resolve(css(".card"), nth(1), css("button"))).toEqual(["b"]);
    expect(await resolve(css(".card"), css("button"), nth(1))).toEqual(["a-deep"]);
    expect(await resolve(css(".card"), css("button"), nth(2), nth(0))).toEqual(["b"]);
    expect(await resolve(css(".card"), nth(0), css(".nested"), css("button"))).toEqual(["a-deep"]);
    expect(await resolve(css(".card"), css("button"))).toEqual(["a", "a-deep", "b"]);
  });

  it("deduplicates overlapping scopes before applying an index", async () => {
    expect(await resolve(css("#cards, .card, #inner"), css("button"))).toEqual([
      "a",
      "a-deep",
      "b",
    ]);
    expect(await resolve(css("#cards, .card, #inner"), css("button"), nth(3))).toEqual([]);
    expect(
      await evaluate(`
      const inner = document.getElementById('inner');
      const outer = document.getElementById('cards');
      const scopes = [inner, document.getElementById('card-b'), outer, inner];
      const chain = ${JSON.stringify({ steps: [css("button")] })};
      const matches = scripts.resolveElementChain(chain, scopes);
      return { ids: ids(matches), sameNode: matches[0] === inner.firstElementChild,
        scopes: ids(scopes), chain };
    `),
    ).toEqual({
      ids: ["a-deep", "b", "a"],
      sameNode: true,
      scopes: ["inner", "card-b", "cards", "inner"],
      chain: { steps: [css("button")] },
    });
  });

  it("never restarts at the document after an empty query or position", async () => {
    expect(await resolve(css(".missing"), css("button"))).toEqual([]);
    expect(await resolve(css(".card"), nth(9), css("button"))).toEqual([]);
    expect(await resolve(css(".card"), nth(1), nth(1), css("button"))).toEqual([]);
    expect(
      await evaluate(
        `return ids(scripts.resolveElementChain(${JSON.stringify({ steps: [css("button")] })}, []));`,
      ),
    ).toEqual([]);
  });

  it("keeps distinct elements with identical IDs and text", async () => {
    await page.evaluate(`document.body.innerHTML =
      '<section class="card"><button id="same">Save</button>' +
      '<button id="same">Save</button></section>'`);
    expect(await resolve(css(".card"), css("button"))).toEqual(["same", "same"]);
    expect(
      await evaluate(`return scripts.resolveElementChain(
      ${JSON.stringify({ steps: [css(".card"), css("button"), nth(1)] })}
    )[0] === document.querySelectorAll('button')[1];`),
    ).toBe(true);
  });

  it.each([css("button"), text("sAvE"), xpath(".//button")])(
    "mixes $selector.kind queries with scoped CSS without escaping the selected card",
    async (query) => {
      expect(await resolve(css(".card"), nth(0), query)).toEqual(["a", "a-deep"]);
      expect(await resolve(css("#a"), query)).toEqual([]);
    },
  );

  it("retains native XPath expressions and element-relative absolute paths", async () => {
    expect(
      await resolve(xpath("//section"), xpath(".//button[normalize-space(.)='Save']")),
    ).toEqual(["a", "b"]);
    expect(await resolve(css("#card-a"), xpath("/button"))).toEqual(["a"]);
    expect(await resolve(css("#card-a"), xpath("//button"))).toEqual(["a", "a-deep"]);
    expect(await resolve(css("#card-a"), xpath(".//button | .//div"))).toEqual([
      "a",
      "inner",
      "a-deep",
    ]);
    expect(
      await resolve(css("#card-a"), xpath("../section | ancestor::* | following-sibling::* | .")),
    ).toEqual([]);
    expect(await resolve(css("#card-a"), xpath("//button | //button[@id='outside']"))).toEqual([
      "a",
      "a-deep",
    ]);
  });

  it("keeps document XPath node results out of element chains", async () => {
    expect(await resolve(xpath("//button/text()"))).toEqual([]);
    expect(await resolve(xpath("//button/@id"), css("button"))).toEqual([]);
    expect(
      await evaluate(
        `return scripts.queryAll({kind: 'xpath', value: '//button/text()'}).map(node => node.nodeType);`,
      ),
    ).toEqual([3, 3, 3, 3]);
  });

  it("preserves native CSS relationships and legacy innermost text matching", async () => {
    expect(await resolve(css("#card-a"), css(":scope > button"))).toEqual(["a"]);
    expect(await resolve(css("#card-a"), css("button + div > button"))).toEqual(["a-deep"]);
    expect(await resolve(css("#card-a"), css(":scope, #card-b, #outside"))).toEqual([]);
    expect(await resolve(css(".card"), text("Save now"))).toEqual(["a-deep"]);
    expect(await resolve(css(".card"), text(" Save "))).toEqual([]);
    expect(await resolve(css(".card"), css("["))).toEqual([]);
  });

  it("uses supplied document scopes and preserves their order", async () => {
    expect(
      await evaluate(`
      const other = document.implementation.createHTMLDocument('other');
      other.body.innerHTML = '<section class="card"><button id="other">Save</button></section>';
      return ids(scripts.resolveElementChain(${JSON.stringify({ steps: [css(".card"), xpath(".//button")] })}, [other, document, other]));
    `),
    ).toEqual(["other", "a", "a-deep", "b"]);
  });

  describe.each(["open", "closed"] as const)("%s shadow roots", (mode) => {
    beforeEach(async () => {
      await page.evaluate(`(() => {
        const host = document.createElement('my-widget');
        host.id = 'host';
        host.innerHTML = '<button id="light">Save</button>';
        document.getElementById('card-b').append(host);
        const root = host.attachShadow({mode: ${JSON.stringify(mode)}});
        root.innerHTML = '<button id="shadow">Save</button>' +
          '<div class="nested"><button id="shadow-deep">Save now</button></div>' +
          '<my-nested id="nested-host"></my-nested>';
        root.querySelector('my-nested').attachShadow({mode: ${JSON.stringify(mode)}}).innerHTML =
          '<button id="nested-shadow">Save</button>';
      })()`);
    });

    it("searches the selected host's own root and nested roots for every engine", async () => {
      for (const query of [css("button"), text("sAvE"), xpath(".//button"), xpath("//button")]) {
        expect(await resolve(css(".card"), nth(1), css("#host"), query)).toEqual([
          "light",
          "shadow",
          "shadow-deep",
          "nested-shadow",
        ]);
        expect(await resolve(css("#host"), query, nth(2))).toEqual(["shadow-deep"]);
      }
      expect(
        await evaluate(`return {
        native: document.getElementById('host').shadowRoot !== null,
        accessor: !!scripts.getOpenOrClosedShadowRoot(document.getElementById('host')),
      };`),
      ).toEqual({ native: mode === "open", accessor: true });
    });

    it("retains per-root CSS combinators while allowing separate scoped queries", async () => {
      expect(await resolve(css("#card-b"), css("my-widget > button"))).toEqual(["light"]);
      expect(await resolve(css("#card-b"), css("#host button"))).toEqual(["light"]);
      expect(await resolve(css("#card-b"), css("div > button"))).toEqual(["shadow-deep"]);
      expect(await resolve(css("#host"), css("my-nested"), css("button"))).toEqual([
        "nested-shadow",
      ]);
    });

    it("keeps ancestor/sibling/self results out and deduplicates overlapping shadow scopes", async () => {
      expect(await resolve(css("#host"), xpath(".."))).toEqual([]);
      expect(await resolve(css("#host"), xpath("ancestor::*"))).toEqual([]);
      expect(await resolve(css("#host"), xpath("following-sibling::*"))).toEqual([]);
      expect(await resolve(css("#host"), xpath("."))).toEqual([]);
      expect(await resolve(css("#host"), css("#outside, #card-b, #host"))).toEqual([]);
      expect(await resolve(css("#card-b, #host, #nested-host"), css("button"))).toEqual([
        "b",
        "light",
        "shadow",
        "shadow-deep",
        "nested-shadow",
      ]);
    });

    it("preserves document shadow hops and scoped XPath child/descendant semantics", async () => {
      expect(await resolve(xpath("/html/body/main/section[2]/my-widget//button"))).toEqual([
        "shadow",
      ]);
      expect(await resolve(css("#host"), xpath("/button"))).toEqual(["light", "shadow"]);
      expect(await resolve(css("#card-a"), xpath("//button"))).toEqual(["a", "a-deep"]);
      expect(await resolve(css("#card-a"), xpath(".//button"))).toEqual(["a", "a-deep"]);
    });
  });

  it("selects iframe elements but leaves frame transitions to the cross-frame resolver", async () => {
    await page.evaluate(`(() => {
      const frame = document.createElement('iframe');
      frame.id = 'frame';
      document.body.append(frame);
      frame.contentDocument.body.innerHTML = '<button id="in-frame">Save</button>';
    })()`);
    expect(await resolve(css("iframe"), nth(0))).toEqual(["frame"]);
    expect(await resolve(css("button"))).toEqual(["a", "a-deep", "b", "outside"]);
    const unsupported: LocatorChain[] = [
      { steps: [css("iframe"), css("button")] },
      { steps: [css("iframe, .card"), css("button")] },
      { steps: [css(".missing"), { type: "frame", selector: { kind: "css", value: "button" } }] },
    ];
    // Read the original page-side error before page.evaluate serializes it.
    expect(
      await evaluate(`return ${JSON.stringify(unsupported)}.map(chain => {
      try { scripts.resolveElementChain(chain); return null; }
      catch (error) { return error.message; }
    });`),
    ).toEqual(unsupported.map(() => "Frame entry is not supported by the element chain resolver"));
    expect(await resolve(css(".card, iframe"), nth(0), css("button"))).toEqual(["a", "a-deep"]);
  });
});
