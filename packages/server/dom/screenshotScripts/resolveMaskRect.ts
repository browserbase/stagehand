export type MaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rootToken?: string | null;
};

export function resolveMaskRect(this: Element | null, maskToken?: string): MaskRect | null {
  type QuadPoint = { x: number; y: number };
  type BoxQuad = { p1: QuadPoint; p2: QuadPoint; p3: QuadPoint; p4: QuadPoint };

  function safeClosest(el: Element | null, selector: string): Element | null {
    try {
      return el && typeof el.closest === "function" ? el.closest(selector) : null;
    } catch {
      return null;
    }
  }

  function safeMatches(el: Element | null, selector: string): boolean {
    try {
      return !!el && typeof el.matches === "function" && el.matches(selector);
    } catch {
      return false;
    }
  }

  function findTopLayerRoot(el: Element | null): Element | null {
    const dialog = safeClosest(el, "dialog[open]");
    if (dialog) return dialog;
    const popover = safeClosest(el, "[popover]");
    if (popover && safeMatches(popover, ":popover-open")) return popover;
    return null;
  }

  if (!this || typeof this.getBoundingClientRect !== "function") return null;
  const rect = this.getBoundingClientRect();
  if (!rect) return null;
  const style = window.getComputedStyle(this);
  if (!style) return null;
  if (style.visibility === "hidden" || style.display === "none") return null;
  if (rect.width <= 0 || rect.height <= 0) return null;

  const root = findTopLayerRoot(this);
  if (root) {
    // Measure the target and root in the same layout state. Adding the temporary attribute can
    // synchronously change geometry through page CSS.
    const rootRect = root.getBoundingClientRect();
    const rootClientLeft = root.clientLeft || 0;
    const rootClientTop = root.clientTop || 0;
    const rootScrollLeft = root.scrollLeft || 0;
    const rootScrollTop = root.scrollTop || 0;
    let localRect = {
      x: rect.left - rootRect.left - rootClientLeft + rootScrollLeft,
      y: rect.top - rootRect.top - rootClientTop + rootScrollTop,
      width: rect.width,
      height: rect.height,
    };

    // getBoxQuads exposes the transformed border-box basis in viewport space. Inverting that
    // affine basis maps the target's viewport bounds back into the root's local coordinate space,
    // so overlays remain aligned when a top-layer dialog/popover is scaled or rotated.
    try {
      const rootWithQuads = root as Element & { getBoxQuads?: () => BoxQuad[] };
      const quad = rootWithQuads.getBoxQuads?.call(root)?.[0];
      const rootElement = root as HTMLElement;
      const borderWidth = rootElement.offsetWidth;
      const borderHeight = rootElement.offsetHeight;
      if (quad && borderWidth > 0 && borderHeight > 0) {
        const a = (quad.p2.x - quad.p1.x) / borderWidth;
        const b = (quad.p2.y - quad.p1.y) / borderWidth;
        const c = (quad.p4.x - quad.p1.x) / borderHeight;
        const d = (quad.p4.y - quad.p1.y) / borderHeight;
        const determinant = a * d - b * c;
        if (Number.isFinite(determinant) && Math.abs(determinant) > 1e-8) {
          const toLocal = (point: QuadPoint): QuadPoint => {
            const x = point.x - quad.p1.x;
            const y = point.y - quad.p1.y;
            return {
              x: (d * x - c * y) / determinant,
              y: (-b * x + a * y) / determinant,
            };
          };
          const points = [
            toLocal({ x: rect.left, y: rect.top }),
            toLocal({ x: rect.right, y: rect.top }),
            toLocal({ x: rect.right, y: rect.bottom }),
            toLocal({ x: rect.left, y: rect.bottom }),
          ];
          const left = Math.min(...points.map((point) => point.x));
          const right = Math.max(...points.map((point) => point.x));
          const top = Math.min(...points.map((point) => point.y));
          const bottom = Math.max(...points.map((point) => point.y));
          localRect = {
            x: left - rootClientLeft + rootScrollLeft,
            y: top - rootClientTop + rootScrollTop,
            width: right - left,
            height: bottom - top,
          };
        }
      }
    } catch {
      // Fall back to untransformed root-relative geometry when box quads are unavailable.
    }
    let rootToken: string | null = null;
    if (maskToken) {
      try {
        const existing = root.getAttribute("data-stagehand-mask-root");
        if (existing && existing.startsWith(maskToken)) {
          rootToken = existing;
        } else {
          rootToken = maskToken + "_root_" + Math.random().toString(36).slice(2);
          root.setAttribute("data-stagehand-mask-root", rootToken);
        }
      } catch {
        rootToken = null;
      }
    }
    return {
      ...localRect,
      rootToken,
    };
  }

  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
    rootToken: null,
  };
}
