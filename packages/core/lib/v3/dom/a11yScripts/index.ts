export function getScrollOffsets(): { sx: number; sy: number } {
  try {
    const sx =
      window.scrollX ??
      window.pageXOffset ??
      document.documentElement?.scrollLeft ??
      0;
    const sy =
      window.scrollY ??
      window.pageYOffset ??
      document.documentElement?.scrollTop ??
      0;
    return { sx: Number(sx) || 0, sy: Number(sy) || 0 };
  } catch {
    return { sx: 0, sy: 0 };
  }
}

export function getBoundingRectLite(this: Element): {
  left: number;
  top: number;
} {
  try {
    const rect = this.getBoundingClientRect();
    return {
      left: Number(rect?.left ?? 0) || 0,
      top: Number(rect?.top ?? 0) || 0,
    };
  } catch {
    return { left: 0, top: 0 };
  }
}

export function resolveDeepActiveElement(): Element | null {
  try {
    const deepActive = (doc: Document | ShadowRoot): Element | null => {
      let el: Element | null = doc.activeElement ?? null;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
      }
      return el ?? null;
    };
    return deepActive(document);
  } catch {
    return null;
  }
}

export function nodeToAbsoluteXPath(this: Node | null | undefined): string {
  const compute = (node: Node | null | undefined): string => {
    try {
      const sibIndex = (n: Node | null | undefined): number => {
        if (!n || !n.parentNode) return 1;
        let i = 1;
        const targetKey = `${n.nodeType}:${(n.nodeName || "").toLowerCase()}`;
        for (let p = n.previousSibling; p; p = p.previousSibling) {
          const key = `${p.nodeType}:${(p.nodeName || "").toLowerCase()}`;
          if (key === targetKey) i += 1;
        }
        return i;
      };

      const step = (n: Node | null | undefined): string => {
        if (!n) return "";
        if (n.nodeType === Node.DOCUMENT_NODE) return "";
        if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return "//";
        if (n.nodeType === Node.TEXT_NODE) return `text()[${sibIndex(n)}]`;
        if (n.nodeType === Node.COMMENT_NODE)
          return `comment()[${sibIndex(n)}]`;
        const tag = (n.nodeName || "").toLowerCase();
        const name = tag.includes(":") ? `*[name()='${tag}']` : tag;
        return `${name}[${sibIndex(n)}]`;
      };

      const parts: string[] = [];
      let cur: Node | null | undefined = node;
      while (cur) {
        if (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          parts.push("//");
          cur = (cur as ShadowRoot).host ?? null;
          continue;
        }
        const s = step(cur);
        if (s) parts.push(s);
        cur = cur.parentNode;
      }
      parts.reverse();

      let out = "";
      for (const part of parts) {
        if (part === "//") {
          out = out ? (out.endsWith("/") ? `${out}/` : `${out}//`) : "//";
        } else {
          out = out
            ? out.endsWith("/")
              ? `${out}${part}`
              : `${out}/${part}`
            : `/${part}`;
        }
      }
      return out || "/";
    } catch {
      return "/";
    }
  };

  return compute(this);
}

export function documentHasFocusStrict(): boolean {
  try {
    return document.hasFocus() === true;
  } catch {
    return false;
  }
}
