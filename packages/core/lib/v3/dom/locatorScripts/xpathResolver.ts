import {
  countXPathNative,
  countXPathWithRoots,
  hasOpenShadowRoots,
  queryXPathNative,
  queryXPathWithRoots,
} from "../selectorRuntime/index.js";

export type XPathResolveOptions = {
  pierceShadow?: boolean;
};

type ShadowContext = {
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
    return resolveNativeAtIndexWithError(xp, targetIndex).value;
  }

  if (!shadowCtx?.hasShadow) {
    const native = resolveNativeAtIndexWithError(xp, targetIndex);
    if (!native.error) return native.value;
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
    return resolveNativeCountWithError(xp).count;
  }

  if (!shadowCtx?.hasShadow) {
    const native = resolveNativeCountWithError(xp);
    if (!native.error) return native.count;
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
    hasShadow: hasOpenShadowRoots.call(document),
  };
}

function resolveNativeAtIndexWithError(
  xp: string,
  index: number,
): { value: Element | null; error: boolean } {
  try {
    const matches = queryXPathNative.call(document, xp, index + 1);
    return {
      value: matches[index] ?? null,
      error: false,
    };
  } catch {
    return { value: null, error: true };
  }
}

function resolveNativeCountWithError(xp: string): {
  count: number;
  error: boolean;
} {
  try {
    return { count: countXPathNative.call(document, xp), error: false };
  } catch {
    return { count: 0, error: true };
  }
}
