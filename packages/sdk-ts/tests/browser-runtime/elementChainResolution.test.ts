import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
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
import { FrameElementChainResolver } from "../../../extension/understudy/elementChainResolver.js";
import { executionContexts } from "../../../extension/understudy/executionContextRegistry.js";
import type { Frame } from "../../../extension/understudy/frame.js";
import type { CDPSessionLike } from "../../../extension/understudy/cdp.js";

type RemoteObject = { objectId?: string; value?: unknown };
type EvaluationResponse = { result: RemoteObject; exceptionDetails?: unknown };
type DescriptionResponse = { node: { backendNodeId: number; attributes?: string[] } };
type PropertiesResponse = { result: Array<{ value?: RemoteObject }> };

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
  let cdp: CDPClient;

  beforeAll(async () => {
    chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(60_000));
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async (options) => {
        cdp = await CDPClient.connect({ ...options, localExtensionDir: extensionDir });
        return cdp;
      },
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

  describe("normalized text queries", () => {
    it("exposes text queries through Page & Locator", async () => {
      expect(await page.getByText("save").count()).toBe(4);
      expect(await page.getByText("Save", { exact: true }).count()).toBe(3);
      const target = page.locator(".card").nth(1).getByText("Save", { exact: true });
      await page.evaluate(
        `document.getElementById('b').onclick = () => document.getElementById('b').textContent = 'Saved'`,
      );
      await target.click();
      expect(await page.getByText("Saved", { exact: true }).first().textContent()).toBe("Saved");
      expect(await page.getByText("Save now").locator("span").count()).toBe(0);
    });

    // Behavior reference: Playwright docs at 09dab5d70932724a848540549f33ff6f9b817e1b.
    // These fixtures specify Stagehand's string-only contract, including empty-string ties.
    it.each([
      {
        name: "whitespace & case",
        html: '<button id="hit"> Save\n\t NOW&nbsp; </button>',
        text: " save now ",
        exact: false,
        expected: ["hit"],
      },
      {
        name: "exact normalized text",
        html: '<button id="hit"> Save\nnow </button><button>save now</button>',
        text: " Save  now ",
        exact: true,
        expected: ["hit"],
      },
      {
        name: "inline descendants",
        html: '<button id="hit">Sa<span>ve</span> <b>now</b></button>',
        text: "Save now",
        exact: true,
        expected: ["hit"],
      },
      {
        name: "smallest matching descendants",
        html: '<section>Save<div><span id="hit">Save</span></div></section>',
        text: "Save",
        exact: false,
        expected: ["hit"],
      },
      {
        name: "equal parent & child",
        html: '<button><span id="hit">Save</span></button>',
        text: "Save",
        exact: true,
        expected: ["hit"],
      },
      {
        name: "whole aggregate for exact",
        html: "<button>Save <span>now</span></button>",
        text: "Save",
        exact: true,
        expected: [],
      },
      {
        name: "input button values",
        html: '<input id="button" type="button" value="Save"><input id="submit" type="submit" value="Save"><input id="reset" type="reset" value="Save"><input type="text" value="Save">',
        text: "Save",
        exact: true,
        expected: ["button", "submit", "reset"],
      },
      {
        name: "skipped content",
        html: '<script>Save</script><style>/* Save */</style><template><button>Save</button></template><noscript>Save</noscript><button id="hit">Save</button>',
        text: "Save",
        exact: true,
        expected: ["hit"],
      },
      {
        name: "hidden text & Unicode",
        html: '<span id="hit" hidden>CAFÉ 東京</span>',
        text: "café 東京",
        exact: false,
        expected: ["hit"],
      },
      {
        name: "empty substring",
        html: '<div><i id="empty"></i><span id="word">word</span></div><p id="blank"> \n </p>',
        text: "",
        exact: false,
        expected: ["empty", "word", "blank"],
      },
      {
        name: "empty exact",
        html: '<div><i id="empty"></i><span>word</span></div><p id="blank"> \n </p>',
        text: " \t",
        exact: true,
        expected: ["empty", "blank"],
      },
      {
        name: "distinct identical matches",
        html: '<button id="a">Save</button><button id="b">Save</button>',
        text: "Save",
        exact: true,
        expected: ["a", "b"],
      },
    ])("$name", async ({ html, text, exact, expected }) => {
      expect(
        await evaluate(`
        document.body.innerHTML = ${JSON.stringify(html)};
        return ids(scripts.collectNormalizedTextMatches(${JSON.stringify(text)}, {exact: ${exact}}));
      `),
      ).toEqual(expected);
    });

    it.each(["open", "closed"])(
      "searches %s roots without duplicating slotted text",
      async (mode) => {
        expect(
          await evaluate(`
        document.body.innerHTML = '<my-widget id="host"><span id="light">Save</span></my-widget>';
        const host = document.getElementById('host');
        const root = host.attachShadow({mode: ${JSON.stringify(mode)}});
        root.innerHTML = '<slot></slot><my-nested></my-nested>';
        root.querySelector('my-nested').attachShadow({mode: ${JSON.stringify(mode)}}).innerHTML = '<button id="shadow">Save</button>';
        return {
          matches: ids(scripts.collectNormalizedTextMatches('Save', {exact: true})),
          scoped: ids(scripts.collectNormalizedTextMatches('Save', {exact: true}, host)),
          doubled: ids(scripts.collectNormalizedTextMatches('SaveSaveSave', {exact: true})),
          aggregate: ids(scripts.collectNormalizedTextMatches('SaveSave', {exact: true})),
        };
      `),
        ).toEqual({
          matches: ["light", "shadow"],
          scoped: ["light", "shadow"],
          doubled: [],
          aggregate: ["host"],
        });
      },
    );

    it("excludes the scope & head, refreshes text & leaves legacy matching unchanged", async () => {
      expect(
        await evaluate(`
        document.body.innerHTML = '<section id="scope"><button id="hit">Save   now</button></section><button id="outside">Save now</button>';
        const scope = document.getElementById('scope');
        const query = () => ids(scripts.collectNormalizedTextMatches('Save now', {}, scope));
        const before = query();
        const self = ids(scripts.collectNormalizedTextMatches('Save now', {}, document.getElementById('hit')));
        const legacyText = ids(scripts.queryAll({kind: 'text', value: ' Save now '}, [scope]));
        document.getElementById('hit').textContent = 'Changed';
        const after = query();
        const title = document.createElement('title');
        title.textContent = 'Head only';
        document.head.append(title);
        const head = ids(scripts.collectNormalizedTextMatches('Head only'));
        title.remove();
        return { before, self, legacyText, after, head };
      `),
      ).toEqual({ before: ["hit"], self: [], legacyText: [], after: [], head: [] });
    });

    it("does not search iframe documents", async () => {
      expect(
        await evaluate(`
        document.body.innerHTML = '<iframe></iframe>';
        const frame = document.querySelector('iframe');
        frame.contentDocument.body.innerHTML = '<button id="child">Frame only</button>';
        return {
          outer: ids(scripts.collectNormalizedTextMatches('Frame only')),
          inner: ids(scripts.collectNormalizedTextMatches('Frame only', {}, frame.contentDocument)),
        };
      `),
      ).toEqual({ outer: [], inner: ["child"] });
    });
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

  async function attachResolver() {
    const { sessionId } = await cdp.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
      targetId: page.pageId,
      flatten: true,
    });
    const calls: Array<{ method: string; params?: object; result?: unknown }> = [];
    const inspect = <T>(method: string, params?: object) =>
      cdp.sendCommand<T>(method, { ...params }, sessionId);
    const session: CDPSessionLike = {
      id: sessionId,
      send: async <T>(method: string, params?: object): Promise<T> => {
        const call: (typeof calls)[number] = { method, params };
        calls.push(call);
        const result = await inspect<T>(method, params);
        call.result = result;
        return result;
      },
      on() {},
      off() {},
      async close() {},
    };
    let contextId: number | undefined;
    const close = async () => {
      if (contextId !== undefined) executionContexts.unregisterExtensionContext(session, contextId);
      await cdp.sendCommand("Target.detachFromTarget", { sessionId });
    };
    try {
      const { frameTree } = await inspect<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
      );
      const created = await inspect<{ executionContextId: number }>("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "element-chain-test",
      });
      contextId = created.executionContextId;
      const source = await readFile(
        new URL("../../../extension/dist/content-script.js", import.meta.url),
        "utf8",
      );
      const installed = await inspect<EvaluationResponse>("Runtime.evaluate", {
        expression: source,
        contextId,
      });
      expect(installed.exceptionDetails).toBeUndefined();
      executionContexts.registerExtensionWorld(session, frameTree.frame.id, contextId);
      const resolver = new FrameElementChainResolver({
        session,
        frameId: frameTree.frame.id,
      } as Frame);
      return { resolver, calls, inspect, session, contextId, close };
    } catch (error) {
      await close();
      throw error;
    }
  }

  it.each([css("button"), text("Save"), xpath(".//button")])(
    "exports only requested $selector.kind targets at 500 and 1,000 matches",
    async (query) => {
      const { resolver, calls, close } = await attachResolver();
      const chain: LocatorChain = { steps: [css(".card"), query] };
      try {
        for (const size of [500, 1000]) {
          await page.evaluate(`document.body.innerHTML = Array.from({length: ${size}}, (_, i) =>
            '<section class="card"><button id="match-' + i + '">Save</button></section>').join('')`);
          calls.length = 0;
          expect(await resolver.resolve(chain, { mode: "count" })).toEqual({
            mode: "count",
            count: size,
          });
          expect(calls.map((call) => call.method)).toEqual([
            "Runtime.evaluate",
            "Runtime.releaseObjectGroup",
          ]);
          expect(calls[0].params).toMatchObject({ returnByValue: true });
          for (const index of [0, size - 1]) {
            calls.length = 0;
            const result = await resolver.resolve(chain, { mode: "selected", index });
            expect(result.mode).toBe("selected");
            if (result.mode === "count") throw new Error("expected targets");
            expect(result.targets).toHaveLength(1);
            expect(calls.map((call) => call.method)).toEqual([
              "Runtime.evaluate",
              "DOM.describeNode",
              "Runtime.releaseObjectGroup",
            ]);
            const { node } = calls[1].result as DescriptionResponse;
            expect(node.attributes).toContain(`match-${index}`);
            expect(result.targets[0].backendNodeId).toBe(node.backendNodeId);
          }
          calls.length = 0;
          const all = await resolver.resolve(chain, { mode: "all" });
          if (all.mode === "count") throw new Error("expected targets");
          expect(all.targets).toHaveLength(size);
          const descriptions = calls.filter((call) => call.method === "DOM.describeNode");
          expect(descriptions).toHaveLength(size);
          expect(all.targets.map((target) => target.backendNodeId)).toEqual(
            descriptions.map((call) => (call.result as DescriptionResponse).node.backendNodeId),
          );
          expect(
            descriptions.map((call) => (call.result as DescriptionResponse).node.attributes?.[1]),
          ).toEqual(Array.from({ length: size }, (_, i) => `match-${i}`));
          expect(
            calls.filter((call) => call.method !== "DOM.describeNode").map((call) => call.method),
          ).toEqual(["Runtime.evaluate", "Runtime.getProperties", "Runtime.releaseObjectGroup"]);
        }
      } finally {
        await close();
      }
    },
    30_000,
  );

  it("releases arrays and element handles while returned identities still resolve to the exact target", async () => {
    const { resolver, calls, inspect, contextId, close } = await attachResolver();
    try {
      const chain: LocatorChain = { steps: [css(".card"), css("button")] };
      const all = await resolver.resolve(chain, { mode: "all" });
      const selected = await resolver.resolve(chain, { mode: "selected", index: 2 });
      if (all.mode === "count" || selected.mode === "count") throw new Error("expected targets");
      expect(all.targets.map((target) => target.backendNodeId)).toContain(
        selected.targets[0].backendNodeId,
      );
      const groups = calls
        .filter((call) => call.method === "Runtime.evaluate")
        .map((call) => (call.params as { objectGroup: string }).objectGroup);
      expect(new Set(groups).size).toBe(2);
      const arraysAndNodes = calls.flatMap((call) => {
        if (call.method === "Runtime.evaluate")
          return [(call.result as EvaluationResponse).result.objectId!];
        if (call.method === "Runtime.getProperties")
          return (call.result as PropertiesResponse).result.flatMap((property) =>
            property.value?.objectId ? [property.value.objectId] : [],
          );
        return [];
      });
      for (const objectId of arraysAndNodes) {
        await expect(inspect("Runtime.getProperties", { objectId })).rejects.toThrow(
          /object|context/i,
        );
      }
      const { object } = await inspect<{ object: RemoteObject }>("DOM.resolveNode", {
        backendNodeId: selected.targets[0].backendNodeId,
        executionContextId: contextId,
      });
      try {
        const live = await inspect<EvaluationResponse>("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration:
            "function() { this.setAttribute('data-selected', 'yes'); return this.id; }",
          returnByValue: true,
        });
        expect(live.exceptionDetails).toBeUndefined();
        expect(live.result.value).toBe("b");
        // Subsequent resolution and cleanup must not release the consumer's handle.
        await resolver.resolve(chain, { mode: "all" });
        const retained = await inspect<EvaluationResponse>("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: "function() { return this.getAttribute('data-selected'); }",
          returnByValue: true,
        });
        expect(retained.result.value).toBe("yes");
      } finally {
        await inspect("Runtime.releaseObject", { objectId: object.objectId });
      }
    } finally {
      await close();
    }
  });

  it("returns empty results in every mode and preserves page-side failures", async () => {
    const { resolver, calls, close } = await attachResolver();
    try {
      const missing: LocatorChain = { steps: [css(".missing"), css("button")] };
      expect(await resolver.resolve(missing, { mode: "count" })).toEqual({
        mode: "count",
        count: 0,
      });
      expect(await resolver.resolve(missing, { mode: "selected", index: 0 })).toEqual({
        mode: "selected",
        targets: [],
      });
      expect(await resolver.resolve(missing, { mode: "all" })).toEqual({
        mode: "all",
        targets: [],
      });
      expect(
        await resolver.resolve({ steps: [css("button")] }, { mode: "selected", index: 9 }),
      ).toEqual({ mode: "selected", targets: [] });
      expect(calls.some((call) => call.method === "DOM.describeNode")).toBe(false);
      await expect(
        resolver.resolve(
          { steps: [css(".card"), { type: "frame", selector: { kind: "css", value: "button" } }] },
          { mode: "count" },
        ),
      ).rejects.toThrow("Frame entry is not supported");
    } finally {
      await close();
    }
  });
});
