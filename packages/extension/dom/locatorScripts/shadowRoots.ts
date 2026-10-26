export function getOpenOrClosedShadowRoot(element: Element): ShadowRoot | null {
  try {
    if (element instanceof HTMLElement) {
      const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(element);
      if (root) return root as ShadowRoot;
    }
  } catch {
    // Fall through to standards-based open-root access.
  }

  try {
    return element.shadowRoot ?? null;
  } catch {
    return null;
  }
}

export function documentHasShadowRoot(): boolean {
  try {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      if (getOpenOrClosedShadowRoot(walker.currentNode as Element)) return true;
    }
  } catch {
    // Treat traversal failures as no shadow roots.
  }
  return false;
}
