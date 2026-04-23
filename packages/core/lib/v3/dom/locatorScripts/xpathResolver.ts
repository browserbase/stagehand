import {
  countXPathNative,
  countXPathWithRoots,
  hasOpenShadowRoots,
  queryXPathNative,
  queryXPathWithRoots,
} from "../selectorRuntime/index.js";

type ClosedRootGetter = (host: Element) => ShadowRoot | null;

export type XPathResolveOptions = {
  pierceShadow?: boolean;
};

type ShadowContext = {
  getClosedRoot: ClosedRootGetter | null;
  hasShadow: boolean;
};

const normalizeXPath = (selector: string): string => {
  const raw = String(selector ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^xpath=/i, "").trim();
};

export function resolveXPathFirst(
  rawXp: string,
  options?: XPathResolveOptions,
): Element | null {
  return resolveXPathAtIndex(rawXp, 0, options);
}

export function resolveXPathAtIndex(
  rawXp: string,
  index: number,
  options?: XPathResolveOptions,
): Element | null {
  if (!Number.isFinite(index) || index < 0) return null;
  const xp = normalizeXPath(rawXp);
  if (!xp) return null;

  const targetIndex = Math.floor(index);
  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext() : null;

  if (!pierceShadow) {
    return (
      queryXPathNative.call(document, xp, targetIndex + 1)[targetIndex] ?? null
    );
  }

  if (!shadowCtx?.hasShadow) {
    const native = queryXPathNative.call(document, xp, targetIndex + 1);
    if (native.length > targetIndex) return native[targetIndex] ?? null;
  }

  return (
    queryXPathWithRoots.call(document, xp, targetIndex + 1)[targetIndex] ?? null
  );
}

export function countXPathMatches(
  rawXp: string,
  options?: XPathResolveOptions,
): number {
  const xp = normalizeXPath(rawXp);
  if (!xp) return 0;

  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext() : null;

  if (!pierceShadow) {
    return countXPathNative.call(document, xp);
  }

  if (!shadowCtx?.hasShadow) {
    const nativeCount = countXPathNative.call(document, xp);
    if (nativeCount > 0) return nativeCount;
  }

  return countXPathWithRoots.call(document, xp);
}

export function resolveXPathComposedMatches(rawXp: string): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];
  return queryXPathWithRoots.call(document, xp, Number.MAX_SAFE_INTEGER);
}

function getShadowContext(): ShadowContext {
  return {
    getClosedRoot: null,
    hasShadow: hasOpenShadowRoots.call(document),
  };
}
