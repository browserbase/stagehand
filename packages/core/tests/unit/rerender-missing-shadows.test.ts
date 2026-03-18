import { JSDOM } from "jsdom";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rerenderMissingShadowHosts } from "../../lib/v3/dom/rerenderMissingShadows.runtime.js";

type DomGlobals = {
  window: Window & typeof globalThis;
  document: Document;
  Node: typeof Node;
  NodeFilter: typeof NodeFilter;
  Element: typeof Element;
  HTMLElement: typeof HTMLElement;
  Document: typeof Document;
  DocumentFragment: typeof DocumentFragment;
  ShadowRoot: typeof ShadowRoot;
  customElements: CustomElementRegistry;
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
  customElements: globalRef.customElements,
};

let dom: JSDOM;

const installDomGlobals = () => {
  const win = dom.window;
  globalRef.window = win as unknown as Window & typeof globalThis;
  globalRef.document = win.document;
  globalRef.Node = win.Node as unknown as typeof Node;
  globalRef.NodeFilter = win.NodeFilter as unknown as typeof NodeFilter;
  globalRef.Element = win.Element as unknown as typeof Element;
  globalRef.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
  globalRef.Document = win.Document as unknown as typeof Document;
  globalRef.DocumentFragment =
    win.DocumentFragment as unknown as typeof DocumentFragment;
  globalRef.ShadowRoot = win.ShadowRoot as unknown as typeof ShadowRoot;
  globalRef.customElements =
    win.customElements as unknown as CustomElementRegistry;
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

/**
 * Helper: set up a fake piercer on `window.__stagehandV3__` backed by a WeakMap.
 * Returns the WeakMap so tests can inspect tracked roots.
 */
function installFakePiercer(): WeakMap<Element, ShadowRoot> {
  const closedRoots = new WeakMap<Element, ShadowRoot>();
  const win = globalRef.window as unknown as Record<string, unknown>;
  win.__stagehandV3__ = {
    getClosedRoot: (el: Element) => closedRoots.get(el) ?? null,
    stats: false,
  };
  return closedRoots;
}

describe("rerenderMissingShadowHosts", () => {
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
    // Clean up any stale custom element registrations by recreating the DOM
    // (JSDOM doesn't support undefining custom elements, but we can use unique tag names per test)
  });

  it("re-renders a custom element with closed shadow so piercer can track it", () => {
    const closedRoots = installFakePiercer();
    const tag = "test-closed-a";
    let constructorCalled = 0;

    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          constructorCalled++;
          const root = this.attachShadow({ mode: "closed" });
          root.innerHTML = "<span>shadow</span>";
          // Simulate piercer intercepting attachShadow
          closedRoots.set(this, root);
        }
      },
    );

    // Manually insert via innerHTML so the constructor fires once for the original
    document.body.innerHTML = `<${tag}></${tag}>`;
    const original = document.querySelector(tag)!;
    // The original was created by innerHTML which does call the constructor in JSDOM
    const callsBefore = constructorCalled;

    // Remove the tracked root to simulate "created before piercer was installed"
    closedRoots.delete(original);

    rerenderMissingShadowHosts();

    const fresh = document.querySelector(tag)!;
    // Constructor was called again for the fresh element
    expect(constructorCalled).toBe(callsBefore + 1);
    // Piercer now tracks the new element's closed root
    expect(closedRoots.has(fresh)).toBe(true);
  });

  it("skips elements that already have an open shadow root", () => {
    installFakePiercer();
    const tag = "test-open-b";

    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" });
        }
      },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const original = document.querySelector(tag)!;

    rerenderMissingShadowHosts();

    // Element should NOT have been replaced
    expect(document.querySelector(tag)).toBe(original);
  });

  it("skips elements whose closed root is already tracked by piercer", () => {
    const closedRoots = installFakePiercer();
    const tag = "test-tracked-c";

    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: "closed" });
          closedRoots.set(this, root);
        }
      },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const original = document.querySelector(tag)!;

    rerenderMissingShadowHosts();

    // Element should NOT have been replaced since piercer already knows about it
    expect(document.querySelector(tag)).toBe(original);
  });

  it("transfers attributes to the fresh element", () => {
    const closedRoots = installFakePiercer();
    const tag = "test-attrs-d";

    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: "closed" });
          closedRoots.set(this, root);
        }
      },
    );

    document.body.innerHTML = `<${tag} id="myid" class="foo bar" data-x="123"></${tag}>`;
    const original = document.querySelector(tag)!;
    // Remove tracking to force re-render
    closedRoots.delete(original);

    rerenderMissingShadowHosts();

    const fresh = document.querySelector(tag)!;
    expect(fresh).not.toBe(original);
    expect(fresh.getAttribute("id")).toBe("myid");
    expect(fresh.getAttribute("class")).toBe("foo bar");
    expect(fresh.getAttribute("data-x")).toBe("123");
  });

  it("moves light DOM children to the fresh element", () => {
    const closedRoots = installFakePiercer();
    const tag = "test-children-e";

    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: "closed" });
          root.innerHTML = "<slot></slot>";
          closedRoots.set(this, root);
        }
      },
    );

    document.body.innerHTML = `<${tag}><span class="child1">A</span><span class="child2">B</span></${tag}>`;
    const original = document.querySelector(tag)!;
    const child1 = original.querySelector(".child1")!;
    const child2 = original.querySelector(".child2")!;
    // Remove tracking to force re-render
    closedRoots.delete(original);

    rerenderMissingShadowHosts();

    const fresh = document.querySelector(tag)!;
    expect(fresh).not.toBe(original);
    // Children should have been moved (same DOM nodes, not cloned)
    expect(fresh.querySelector(".child1")).toBe(child1);
    expect(fresh.querySelector(".child2")).toBe(child2);
    expect(fresh.children.length).toBe(2);
  });

  it("skips elements whose constructor throws without breaking the rest", () => {
    const closedRoots = installFakePiercer();
    const tagBad = "test-throws-f";
    const tagGood = "test-good-f";
    let badCreated = false;

    customElements.define(
      tagBad,
      class extends HTMLElement {
        constructor() {
          super();
          if (badCreated) {
            throw new Error("constructor boom");
          }
          badCreated = true;
        }
      },
    );

    customElements.define(
      tagGood,
      class extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: "closed" });
          closedRoots.set(this, root);
        }
      },
    );

    document.body.innerHTML = `<${tagBad}></${tagBad}><${tagGood}></${tagGood}>`;
    // Remove tracking from the good element so it needs re-render
    const goodOriginal = document.querySelector(tagGood)!;
    closedRoots.delete(goodOriginal);

    // Should not throw even though tagBad's constructor will throw on re-create
    expect(() => rerenderMissingShadowHosts()).not.toThrow();

    // The good element should have been re-rendered successfully
    const freshGood = document.querySelector(tagGood)!;
    expect(closedRoots.has(freshGood)).toBe(true);
  });
});
