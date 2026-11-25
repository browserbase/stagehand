export function getOpenOrClosedShadowRoot(element: Element): ShadowRoot | null {
  try {
    if (element instanceof HTMLElement) {
      const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(element);
      if (root) return root as ShadowRoot;
    }
  } catch {}

  try {
    return element.shadowRoot ?? null;
  } catch {
    return null;
  }
}

export function documentHasShadowRoot(scope: Document = document): boolean {
  try {
    const walker = scope.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      if (getOpenOrClosedShadowRoot(walker.currentNode as Element)) return true;
    }
  } catch {}
  return false;
}
