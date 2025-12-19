export function rerenderMissingShadowHosts(): void {
  try {
    const piercer = window.__stagehandV3__;
    if (!piercer || typeof piercer.getClosedRoot !== "function") return;

    const needsReset: Element[] = [];
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode as Element;
      const tag = el.tagName?.toLowerCase() ?? "";
      if (!tag.includes("-")) continue;
      if (typeof customElements?.get !== "function") continue;
      if (!customElements.get(tag)) continue;
      const hasOpen = !!el.shadowRoot;
      const hasClosed = !!piercer.getClosedRoot(el);
      if (hasOpen || hasClosed) continue;
      needsReset.push(el);
    }

    for (const host of needsReset) {
      try {
        const clone = host.cloneNode(true);
        host.replaceWith(clone);
      } catch {
        // ignore individual failures
      }
    }

    if (piercer.stats && needsReset.length) {
      console.info("[v3-piercer] rerender", { count: needsReset.length });
    }
  } catch (err) {
    console.info("[v3-piercer] rerender error", { message: String(err ?? "") });
  }
}
