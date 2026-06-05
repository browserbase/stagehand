export interface RefMaps {
  urlMap: Record<string, string>;
  xpathMap: Record<string, string>;
}

export function emptyRefMaps(): RefMaps {
  return { urlMap: {}, xpathMap: {} };
}

function parseRef(selector: string): string | null {
  if (selector.startsWith("@")) {
    const rest = selector.slice(1);
    return rest.startsWith("[") && rest.endsWith("]")
      ? rest.slice(1, -1)
      : rest;
  }

  if (
    selector.startsWith("[") &&
    selector.endsWith("]") &&
    /^\[\d+-\d+]$/.test(selector)
  ) {
    return selector.slice(1, -1);
  }

  if (selector.startsWith("ref=")) {
    return selector.slice(4);
  }

  return /^\d+-\d+$/.test(selector) ? selector : null;
}

export function resolveSelector(selector: string, refMaps: RefMaps): string {
  const ref = parseRef(selector);
  if (!ref) return selector;

  const xpath = refMaps.xpathMap[ref];
  if (!xpath) {
    throw new Error(
      `Unknown ref "${ref}" - run browse snapshot first to populate refs (have ${Object.keys(refMaps.xpathMap).length} refs).`,
    );
  }

  return xpath;
}
