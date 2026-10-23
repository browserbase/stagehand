import { countXPathMatches } from "./xpathResolver.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";
import { collectInnermostTextMatches, textUsedForMatch } from "./textMatches.js";

export interface TextMatchSample {
  tag: string;
  id: string;
  class: string;
  text: string;
}

export interface TextMatchResult {
  count: number;
  sample: TextMatchSample[];
  error: null;
}

export function countCssMatchesPrimary(selectorRaw: string): number {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return 0;

  const seen = new WeakSet<Node>();

  const visit = (root: Node | null | undefined): number => {
    if (!root || seen.has(root)) return 0;
    seen.add(root);

    let total = 0;
    try {
      const queryable = root as unknown as ParentNode & {
        querySelectorAll?: Document["querySelectorAll"];
      };
      if (typeof queryable.querySelectorAll === "function") {
        total += queryable.querySelectorAll(selector).length;
      }
    } catch {
      // ignore query errors
    }

    try {
      const doc = root instanceof Document ? root : ((root as Element)?.ownerDocument ?? document);
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node instanceof Element) {
          const shadowRoot = getOpenOrClosedShadowRoot(node);
          if (shadowRoot) total += visit(shadowRoot);
        }
      }
    } catch {
      // ignore traversal errors
    }

    return total;
  };

  try {
    return visit(document);
  } catch {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }
}

const classNameOf = (element: Element): string => {
  try {
    const value = (element as HTMLElement).className;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
};

export function countTextMatches(rawNeedle: string): TextMatchResult {
  const needle = String(rawNeedle ?? "");
  if (!needle) {
    return { count: 0, sample: [], error: null };
  }

  const matches = collectInnermostTextMatches(needle);
  const sample = matches.slice(0, 5).map((element) => ({
    tag: element.tagName ?? "",
    id: element.id ?? "",
    class: classNameOf(element),
    text: textUsedForMatch(element),
  }));

  return { count: matches.length, sample, error: null };
}

export function countXPathMatchesMainWorld(rawXp: string): number {
  return countXPathMatches(rawXp, { pierceShadow: true });
}
