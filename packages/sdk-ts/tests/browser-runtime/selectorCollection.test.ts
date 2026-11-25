import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@browserbasehq/stagehand-browser-api/page";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import type { StagehandBrowser } from "../../src/browser/index.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";
import { FrameSelectorResolver } from "../../../extension/understudy/selectorResolver.js";
import { executionContexts } from "../../../extension/understudy/executionContextRegistry.js";
import type { CDPSessionLike } from "../../../extension/understudy/cdp.js";
import type { Frame } from "../../../extension/understudy/frame.js";

const extensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));

describe("page-side selector collection", () => {
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

  it("returns counts, selected ranges and complete lists for each engine", async () => {
    expect(
      await evaluate(`return [
      {kind: 'css', value: 'button'}, {kind: 'text', value: 'Save'}, {kind: 'xpath', value: '//button'},
    ].map(query => ({
      count: scripts.resolveQuery(query, {mode: 'count'}),
      first: ids(scripts.resolveQuery(query, {mode: 'range', start: 0, end: 1})),
      range: ids(scripts.resolveQuery(query, {mode: 'range', start: 2, end: 4})),
      missing: ids(scripts.resolveQuery(query, {mode: 'range', start: 7, end: 8})),
      all: ids(scripts.resolveQuery(query, {mode: 'all'})),
    }));`),
    ).toEqual(
      [rootOrder, rootOrder, composedOrder].map((order) => ({
        count: 7,
        first: order.slice(0, 1),
        range: order.slice(2, 4),
        missing: [],
        all: order,
      })),
    );
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

  async function attachResolver(target = page) {
    const { sessionId } = await cdp.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
      targetId: target.pageId,
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
      on: () => {},
      off: () => {},
      close: async () => {},
    };
    const { frameTree } = await session.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    const { executionContextId } = await session.send<{ executionContextId: number }>(
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: "selector-lifetime-test" },
    );
    try {
      const source = await readFile(
        new URL("../../../extension/dist/content-script.js", import.meta.url),
        "utf8",
      );
      const installed = await session.send<{ exceptionDetails?: unknown }>("Runtime.evaluate", {
        expression: source,
        contextId: executionContextId,
      });
      expect(installed.exceptionDetails).toBeUndefined();
      executionContexts.registerExtensionWorld(session, frameTree.frame.id, executionContextId);
      const resolver = new FrameSelectorResolver({ session, frameId: frameTree.frame.id } as Frame);
      calls.length = 0;
      return {
        resolver,
        session,
        calls,
        inspect,
        readIds: async (objectIds: string[]) => {
          const response = await inspect<{
            result: { value: string[] };
            exceptionDetails?: unknown;
          }>("Runtime.callFunctionOn", {
            executionContextId,
            functionDeclaration: "function(...nodes) { return nodes.map(node => node.id); }",
            arguments: objectIds.map((objectId) => ({ objectId })),
            returnByValue: true,
          });
          expect(response.exceptionDetails).toBeUndefined();
          return response.result.value;
        },
        close: async () => {
          executionContexts.unregisterExtensionContext(session, executionContextId);
          await cdp.sendCommand("Target.detachFromTarget", { sessionId });
        },
      };
    } catch (error) {
      executionContexts.unregisterExtensionContext(session, executionContextId);
      await cdp.sendCommand("Target.detachFromTarget", { sessionId });
      throw error;
    }
  }

  it("releases a batch's array and nodes without releasing another batch or an action target", async () => {
    const { resolver, session, calls, inspect, readIds, close } = await attachResolver();
    try {
      const query = { kind: "css", value: "#light-a, #light-b" } as const;
      const selected = await resolver.resolveAtIndex(query, 1);
      expect(selected).not.toBeNull();
      const batch = await resolver.resolveAll(query);
      const collection = calls.find(
        (call) =>
          call.method === "Runtime.evaluate" &&
          (call.params as { objectGroup?: string }).objectGroup,
      );
      expect(collection).toBeDefined();
      const batchArray = (collection!.result as { result: { objectId: string } }).result.objectId;
      const other = await resolver.resolveAll(query);
      const groups = calls
        .filter(
          (call) =>
            call.method === "Runtime.evaluate" &&
            (call.params as { objectGroup?: string }).objectGroup,
        )
        .map((call) => (call.params as { objectGroup: string }).objectGroup);
      expect(new Set(groups).size).toBe(2);
      const readId = async (objectId: string) => (await readIds([objectId]))[0];
      try {
        expect(await Promise.all(batch.nodes.map((node) => readId(node.objectId)))).toEqual([
          "light-a",
          "light-b",
        ]);
        await batch.release();
        for (const node of batch.nodes) {
          await expect(readId(node.objectId)).rejects.toThrow(/object|context/i);
        }
        await expect(inspect("Runtime.getProperties", { objectId: batchArray })).rejects.toThrow(
          /object|context/i,
        );
        expect(await readIds(other.nodes.map((node) => node.objectId))).toEqual([
          "light-a",
          "light-b",
        ]);
        expect(await readId(selected!.objectId)).toBe("light-b");
        const range = await resolver.resolveAll(query, { start: 1, limit: 1 });
        try {
          expect(await Promise.all(range.nodes.map((node) => readId(node.objectId)))).toEqual([
            "light-b",
          ]);
          expect(await resolver.count(query)).toBe(2);
        } finally {
          await range.release();
        }
      } finally {
        await batch.release();
        await other.release();
        if (selected) await session.send("Runtime.releaseObject", { objectId: selected.objectId });
      }
    } finally {
      await close();
    }
  });

  it("uses batched masks through the SDK and leaves later locator actions usable", async () => {
    const screenshot = await page.screenshot({ mask: [page.locator("button")], timeout: 5_000 });
    expect([...screenshot.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await page.locator("button").count()).toBe(7);
    expect(await page.locator("button").nth(5).textContent()).toBe("Save");
  });

  it.each([
    { kind: "css", value: "button" },
    { kind: "text", value: "Save" },
    { kind: "xpath", value: "//button" },
  ] as const)(
    "bounds $kind resolution and cleanup calls at 500 and 1,000 matches",
    async (query) => {
      const { resolver, session, calls, readIds, close } = await attachResolver();
      const traffic: Array<Record<string, string[]>> = [];
      try {
        for (const size of [500, 1000]) {
          await page.evaluate(`document.body.innerHTML = Array.from({length: ${size}}, (_, i) =>
          '<button id="match-' + i + '">Save</button>').join('')`);
          const methods = () => calls.map((call) => call.method);
          const measured: Record<string, string[]> = {};

          calls.length = 0;
          expect(await resolver.count(query)).toBe(size);
          expect(methods()).toEqual(["Runtime.evaluate"]);
          expect(calls[0].params).toMatchObject({ returnByValue: true });
          expect(calls[0].result).toMatchObject({ result: { type: "number", value: size } });
          measured.count = methods();

          for (const index of [0, size - 1]) {
            calls.length = 0;
            const selected =
              index === 0
                ? await resolver.resolveFirst(query)
                : await resolver.resolveAtIndex(query, index);
            expect(selected).not.toBeNull();
            try {
              expect(await readIds([selected!.objectId])).toEqual([`match-${index}`]);
              expect(methods()).toEqual(["Runtime.evaluate", "DOM.requestNode"]);
              expect(calls[0].result).toMatchObject({
                result: { subtype: "node", objectId: selected!.objectId },
              });
              expect(calls[1].params).toEqual({ objectId: selected!.objectId });
            } finally {
              if (selected)
                await session.send("Runtime.releaseObject", { objectId: selected.objectId });
            }
            expect(methods()).toEqual([
              "Runtime.evaluate",
              "DOM.requestNode",
              "Runtime.releaseObject",
            ]);
            measured[index === 0 ? "first" : "nth"] = methods();
          }

          for (const mode of ["all", "range"] as const) {
            calls.length = 0;
            const options = mode === "all" ? {} : { start: size - 2, limit: 2 };
            const batch = await resolver.resolveAll(query, options);
            try {
              const expectedIds = Array.from(
                { length: mode === "all" ? size : 2 },
                (_, i) => `match-${mode === "all" ? i : size - 2 + i}`,
              );
              expect(await readIds(batch.nodes.map((node) => node.objectId))).toEqual(expectedIds);
              expect(methods()).toEqual(["Runtime.evaluate", "Runtime.getProperties"]);
              const properties = calls[1].result as {
                result: Array<{ name: string; value?: { objectId?: string } }>;
              };
              const exported = properties.result.filter((property) => /^\d+$/.test(property.name));
              expect(exported.map((property) => property.value?.objectId)).toEqual(
                batch.nodes.map((node) => node.objectId),
              );
              expect(calls[1].params).toMatchObject({
                objectId: (calls[0].result as { result: { objectId: string } }).result.objectId,
                ownProperties: true,
              });
            } finally {
              await batch.release();
            }
            expect(methods()).toEqual([
              "Runtime.evaluate",
              "Runtime.getProperties",
              "Runtime.releaseObjectGroup",
            ]);
            const group = (calls[0].params as { objectGroup: string }).objectGroup;
            expect(group).toEqual(expect.any(String));
            expect(calls[2].params).toEqual({ objectGroup: group });
            measured[mode] = methods();
          }
          traffic.push(measured);
        }
        expect(traffic[1]).toEqual(traffic[0]);
      } finally {
        await close();
      }
    },
  );

  it("releases a batch after navigation destroys its execution context", async () => {
    const target = await browser!.context.newPage();
    try {
      await target.evaluate("document.body.innerHTML = '<button>Save</button>'");
      const { resolver, calls, readIds, close } = await attachResolver(target);
      try {
        const batch = await resolver.resolveAll({ kind: "css", value: "button" });
        expect(batch.nodes).toHaveLength(1);
        const group = (calls[0].params as { objectGroup: string }).objectGroup;
        try {
          await target.goto("about:blank");
          await expect(readIds(batch.nodes.map((node) => node.objectId))).rejects.toThrow(
            /context|object/i,
          );
        } finally {
          await batch.release();
        }
        expect(calls.at(-1)).toMatchObject({
          method: "Runtime.releaseObjectGroup",
          params: { objectGroup: group },
        });
      } finally {
        await close();
      }
    } finally {
      await target.close();
    }
  });
});
