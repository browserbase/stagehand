(() => {
  // Map <host ➜ shadowRoot> for every root created in closed mode
  const closedRoots: WeakMap<Element, ShadowRoot> = new WeakMap();

  // Preserve the original method
  const nativeAttachShadow = Element.prototype.attachShadow;

  // Intercept *before any page script runs*
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const root = nativeAttachShadow.call(this, init);
    if (init.mode === "closed") closedRoots.set(this, root);
    return root;
  };

  interface StagehandBackdoor {
    /** Get the real ShadowRoot (undefined if host has none / is open) */
    getClosedRoot(host: Element): ShadowRoot | undefined;

    /** CSS‑selector search inside that root */
    queryClosed(host: Element, selector: string): Element[];

    /** XPath search inside that root (relative XPath supported) */
    xpathClosed(host: Element, xpath: string): Node[];
  }

  const backdoor: StagehandBackdoor = {
    getClosedRoot: (host) => closedRoots.get(host),

    queryClosed: (host, selector) => {
      const root = closedRoots.get(host);
      return root ? Array.from(root.querySelectorAll(selector)) : [];
    },

    xpathClosed: (host, xp) => {
      const root = closedRoots.get(host);
      if (!root) return [];
      const it = document.evaluate(
        xp,
        root,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      const out: Node[] = [];
      for (let i = 0; i < it.snapshotLength; ++i) {
        const n = it.snapshotItem(i);
        if (n) out.push(n);
      }
      return out;
    },
  };

  if (!("__stagehand__" in window)) {
    Object.defineProperty(window, "__stagehand__", {
      value: backdoor,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
})();
