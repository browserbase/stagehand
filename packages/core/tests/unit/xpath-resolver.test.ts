import { JSDOM } from "jsdom";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  countXPathMatches,
  resolveXPathAtIndex,
} from "../../lib/v3/dom/locatorScripts/xpathResolver.js";

type DomGlobals = {
  window: Window;
  document: Document;
  Node: typeof Node;
  NodeFilter: typeof NodeFilter;
  Element: typeof Element;
  HTMLElement: typeof HTMLElement;
  Document: typeof Document;
  DocumentFragment: typeof DocumentFragment;
  ShadowRoot: typeof ShadowRoot;
  XPathResult: typeof XPathResult;
};

const globalRef = globalThis as typeof globalThis & Partial<DomGlobals>;
const originalGlobals: Partial<DomGlobals> = {
  window: globalRef.window,
  document: globalRef.document,
  Node: globalRef.Node,
  NodeFilter: globalRef.NodeFilter,
  Element: globalRef.Element,
  HTMLElement: globalRef.HTMLElement,
  Document: globalRef.Document,
  DocumentFragment: globalRef.DocumentFragment,
  ShadowRoot: globalRef.ShadowRoot,
  XPathResult: globalRef.XPathResult,
};

let dom: JSDOM;

const installDomGlobals = () => {
  const win = dom.window;
  globalRef.window = win as unknown as Window;
  globalRef.document = win.document;
  globalRef.Node = win.Node as unknown as typeof Node;
  globalRef.NodeFilter = win.NodeFilter as unknown as typeof NodeFilter;
  globalRef.Element = win.Element as unknown as typeof Element;
  globalRef.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
  globalRef.Document = win.Document as unknown as typeof Document;
  globalRef.DocumentFragment =
    win.DocumentFragment as unknown as typeof DocumentFragment;
  globalRef.ShadowRoot = win.ShadowRoot as unknown as typeof ShadowRoot;
  globalRef.XPathResult = win.XPathResult as unknown as typeof XPathResult;
};

const restoreDomGlobals = () => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete (globalRef as Record<string, unknown>)[key];
    } else {
      (globalRef as Record<string, unknown>)[key] = value;
    }
  }
};

describe("xpathResolver composed traversal", () => {
  beforeAll(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    installDomGlobals();
  });

  afterAll(() => {
    dom.window.close();
    restoreDomGlobals();
  });

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("counts matches across light + shadow DOM without double counting", () => {
    document.body.innerHTML =
      '<div id="light-1"></div>' +
      '<shadow-host id="host"></shadow-host>' +
      '<div id="light-2"></div>';

    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div id="shadow-1"></div><div id="shadow-2"></div>';

    expect(countXPathMatches("//div")).toBe(4);
  });

  it("resolves nth over composed tree in document-order DFS", () => {
    document.body.innerHTML =
      '<div id="light-1"></div>' +
      '<shadow-host id="host"></shadow-host>' +
      '<div id="light-2"></div>';

    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div id="shadow-1"></div><div id="shadow-2"></div>';

    expect(resolveXPathAtIndex("//div", 0)?.id).toBe("light-1");
    expect(resolveXPathAtIndex("//div", 1)?.id).toBe("shadow-1");
    expect(resolveXPathAtIndex("//div", 2)?.id).toBe("shadow-2");
    expect(resolveXPathAtIndex("//div", 3)?.id).toBe("light-2");
  });
});
