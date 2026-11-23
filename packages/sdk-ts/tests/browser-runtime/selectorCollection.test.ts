import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@browserbasehq/stagehand-browser-api/page";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import type { StagehandBrowser } from "../../src/browser/index.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const extensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));

describe("page-side selector collection", () => {
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  let page: Page;

  // The extension's blank page loads the real registry and chrome.dom API into
  // its main world, so these checks exercise closed roots without a DOM mock.
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

  const evaluate = (body: string) =>
    page.evaluate(`(() => {
      const scripts = globalThis.__stagehandLocatorScripts;
      const query = (kind, value, scopes) => scripts.queryAll({ kind, value }, scopes);
      const ids = nodes => nodes.map(node => node.id);
      const scope = document.getElementById('scope');
      const open = document.getElementById('open');
      const closed = document.getElementById('closed');
      ${body}
    })()`);

  beforeEach(async () => {
    await page.evaluate(`(() => {
      document.body.innerHTML = '<section id="scope"><button id="light-a">Save</button>' +
        '<my-widget id="open"><button id="light-host">Save</button></my-widget></section>' +
        '<button id="light-b">Save</button><my-widget id="closed"></my-widget>';
      const open = document.getElementById('open').attachShadow({mode: 'open'});
      open.innerHTML = '<button id="open-a">Save</button>' +
        '<div><button id="open-deep">Save</button></div><my-nested></my-nested>';
      open.querySelector('my-nested').attachShadow({mode: 'closed'}).innerHTML =
        '<button id="nested-a">Save</button>';
      document.getElementById('closed').attachShadow({mode: 'closed'}).innerHTML =
        '<button id="closed-a">Save</button>';
    })()`);
  });

  const rootOrder = [
    "light-a",
    "light-host",
    "light-b",
    "open-a",
    "open-deep",
    "closed-a",
    "nested-a",
  ];
  const composedOrder = [
    "light-a",
    "light-host",
    "open-a",
    "open-deep",
    "nested-a",
    "light-b",
    "closed-a",
  ];

  it("collects CSS and text by root, and XPath in composed traversal order", async () => {
    expect(
      await evaluate(`return {
      css: ids(query('css', 'button')),
      text: ids(query('text', 'sAvE')),
      xpath: ids(query('xpath', '//button')),
      closed: closed.shadowRoot === null && !!scripts.getOpenOrClosedShadowRoot(closed),
    };`),
    ).toEqual({ css: rootOrder, text: rootOrder, xpath: composedOrder, closed: true });
  });

  it("keeps first, nth, out-of-range and count results aligned with the match list", async () => {
    expect(
      await evaluate(`return [
      ['css', 'button', 'resolveCssSelector', 'countCssMatchesPrimary'],
      ['text', 'Save', 'resolveTextSelector', 'countTextMatches'],
      ['xpath', '//button', 'resolveXPathMainWorld', 'countXPathMatchesMainWorld'],
    ].map(([kind, value, resolve, count]) => {
      const matches = query(kind, value);
      const counted = scripts[count](value);
      return {
        same: matches.every((node, index) => scripts[resolve](value, index) === node),
        first: scripts[resolve](value, -1) === matches[0],
        fractional: scripts[resolve](value, 1.9) === matches[1],
        missing: scripts[resolve](value, matches.length),
        count: typeof counted === 'number' ? counted : counted.count,
      };
    });`),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        same: true,
        first: true,
        fractional: true,
        missing: null,
        count: 7,
      })),
    );
  });

  it("preserves native CSS combinators at each shadow boundary", async () => {
    expect(
      await evaluate(`return [
      ids(query('css', 'my-widget > button')),
      ids(query('css', '#open button')),
      ids(query('css', 'div > button')),
    ];`),
    ).toEqual([["light-host"], ["light-host"], ["open-deep"]]);
  });

  it("includes an element scope's own open or closed root and excludes the scope", async () => {
    expect(
      await evaluate(`return ['css', 'text', 'xpath'].map(kind => ({
      open: ids(query(kind, kind === 'css' ? 'button' : kind === 'text' ? 'Save' : './/button', [open])),
      closed: ids(query(kind, kind === 'css' ? 'button' : kind === 'text' ? 'Save' : './/button', [closed])),
      self: ids(query(kind, kind === 'css' ? 'button' : kind === 'text' ? 'Save' : '.',
        [document.getElementById('light-a')])),
    }));`),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        open: ["light-host", "open-a", "open-deep", "nested-a"],
        closed: ["closed-a"],
        self: [],
      })),
    );
  });

  it("deduplicates overlapping scopes by identity while preserving scope order", async () => {
    expect(
      await evaluate(`return ['css', 'text', 'xpath'].map(kind =>
      ids(query(kind, kind === 'css' ? 'button' : kind === 'text' ? 'Save' : '//button',
        [open, scope, document, open])));`),
    ).toEqual(
      Array.from({ length: 3 }, () => [
        "light-host",
        "open-a",
        "open-deep",
        "nested-a",
        "light-a",
        "light-b",
        "closed-a",
      ]),
    );
  });

  it("retains document XPath shadow hops separately from relative element queries", async () => {
    expect(
      await evaluate(`return [
      ids(query('xpath', '/html/body/section/my-widget//button', [document])),
      ids(query('xpath', './/button', [open])),
      ids(query('xpath', '/button', [open])),
    ];`),
    ).toEqual([
      ["open-a"],
      ["light-host", "open-a", "open-deep", "nested-a"],
      ["light-host", "open-a"],
    ]);
  });

  it("preserves malformed input behavior, including the existing XPath fallback", async () => {
    expect(
      await evaluate(`return {
      css: ids(query('css', '[')),
      xpath: ids(query('xpath', '//button[')),
      empty: ['css', 'text', 'xpath'].map(kind => ids(query(kind, ''))),
      missing: ids(query('css', '.missing')),
      noScopes: ids(query('css', 'button', [])),
    };`),
    ).toEqual({ css: [], xpath: composedOrder, empty: [[], [], []], missing: [], noScopes: [] });
  });

  it("uses native document XPath without shadows and confines relative results to their scope", async () => {
    expect(
      await evaluate(`
      document.body.innerHTML = '<section id="native-scope"><button id="a">Save</button>' +
        '<span id="b">Save</span></section><button id="outside">Save</button>';
      const nativeScope = document.getElementById('native-scope');
      return {
        union: ids(query('xpath', '//button | //span')),
        relative: ids(query('xpath', './/button | .//span', [nativeScope])),
        absolute: ids(query('xpath', '//button', [nativeScope])),
        escape: ids(query('xpath', '../button | .', [nativeScope])),
        malformed: ids(query('xpath', '//button[')),
        text: ids(query('text', 'Save', [nativeScope])),
      };`),
    ).toEqual({
      union: ["a", "b", "outside"],
      relative: ["a", "b"],
      absolute: ["a"],
      escape: [],
      malformed: ["a", "outside"],
      text: ["a", "b"],
    });
  });

  it("keeps innermost substring text semantics and does not enter iframe documents", async () => {
    expect(
      await evaluate(`
      document.body.innerHTML = '<div id="parent">Save <span id="leaf">Save now</span></div>' +
        '<script>Save</script><iframe></iframe>';
      document.querySelector('iframe').contentDocument.body.innerHTML = '<button id="frame">Save</button>';
      return {
        text: ids(query('text', 'save')),
        whitespace: ids(query('text', ' Save ')),
        css: ids(query('css', 'button')),
        xpath: ids(query('xpath', '//button')),
      };`),
    ).toEqual({ text: ["leaf"], whitespace: ["parent"], css: [], xpath: [] });
  });

  it("preserves native XPath result types, prefixes and indexed selection without shadows", async () => {
    expect(
      await evaluate(`
      document.body.innerHTML = '<button id="a">Save</button><button id="b">Save</button>';
      const value = ' xpath=//button ';
      const matches = query('xpath', value);
      return {
        ids: ids(matches),
        same: matches.every((node, index) => scripts.resolveXPathMainWorld(value, index) === node),
        missing: scripts.resolveXPathMainWorld(value, 2),
        count: scripts.countXPathMatchesMainWorld(value),
        nodeTypes: query('xpath', '//button/text()').map(node => node.nodeType),
      };`),
    ).toEqual({ ids: ["a", "b"], same: true, missing: null, count: 2, nodeTypes: [3, 3] });
  });

  it("resolves supplied documents rather than the ambient document", async () => {
    expect(
      await evaluate(`
      const other = document.implementation.createHTMLDocument('scope');
      other.body.innerHTML = '<button id="other">Save</button><my-widget></my-widget>';
      const native = ids(query('xpath', '//button | //span', [other]));
      other.querySelector('my-widget').attachShadow({mode: 'open'}).innerHTML =
        '<button id="other-shadow">Save</button>';
      return {
        native,
        matches: ['css', 'text', 'xpath'].map(kind =>
          ids(query(kind, kind === 'css' ? 'button' : kind === 'text' ? 'Save' : '//button', [other]))),
        hop: ids(query('xpath', '/html/body/my-widget//button', [other])),
      };`),
    ).toEqual({
      native: ["other"],
      matches: Array.from({ length: 3 }, () => ["other", "other-shadow"]),
      hop: ["other-shadow"],
    });
  });
});
