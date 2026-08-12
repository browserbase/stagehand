export type MaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rootToken?: string | null;
  position?: "absolute" | "fixed";
};

export function resolveMaskRect(this: Element | null, maskToken?: string): MaskRect | null {
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

    // Chromium does not expose getBoxQuads(), and an affine inverse is insufficient for
    // perspective transforms. Measure both boxes while the root's own transforms are temporarily
    // neutralized instead. Transforms do not participate in layout, so this yields the coordinates
    // used by an absolutely positioned child; restoring the transform then projects the overlay
    // through the same 2D or 3D transform as the target.
    try {
      const rootElement = root as HTMLElement;
      const transformProperties = ["transform", "translate", "rotate", "scale"] as const;
      const previous = transformProperties.map((property) => ({
        property,
        value: rootElement.style.getPropertyValue(property),
        priority: rootElement.style.getPropertyPriority(property),
      }));
      const previousTransition = {
        value: rootElement.style.getPropertyValue("transition"),
        priority: rootElement.style.getPropertyPriority("transition"),
      };
      const previousWillChange = {
        value: rootElement.style.getPropertyValue("will-change"),
        priority: rootElement.style.getPropertyPriority("will-change"),
      };
      try {
        // Prevent the temporary transform reset from being interpolated. `will-change: transform`
        // preserves the containing block for fixed descendants while the transform is `none`.
        rootElement.style.setProperty("transition", "none", "important");
        rootElement.style.setProperty("will-change", "transform", "important");
        root.getBoundingClientRect();
        for (const property of transformProperties) {
          rootElement.style.setProperty(property, "none", "important");
        }
        const untransformedRootRect = root.getBoundingClientRect();
        const untransformedTargetRect = this.getBoundingClientRect();
        if (
          untransformedTargetRect.width > 0 &&
          untransformedTargetRect.height > 0 &&
          Number.isFinite(untransformedRootRect.left) &&
          Number.isFinite(untransformedRootRect.top)
        ) {
          // A small bleed prevents transformed edge antialiasing from exposing target pixels.
          const maskBleed = 3;
          localRect = {
            x:
              untransformedTargetRect.left -
              untransformedRootRect.left -
              rootClientLeft +
              rootScrollLeft -
              maskBleed,
            y:
              untransformedTargetRect.top -
              untransformedRootRect.top -
              rootClientTop +
              rootScrollTop -
              maskBleed,
            width: untransformedTargetRect.width + maskBleed * 2,
            height: untransformedTargetRect.height + maskBleed * 2,
          };
        }
      } finally {
        for (const { property, value, priority } of previous) {
          if (value) rootElement.style.setProperty(property, value, priority);
          else rootElement.style.removeProperty(property);
        }
        if (previousWillChange.value) {
          rootElement.style.setProperty(
            "will-change",
            previousWillChange.value,
            previousWillChange.priority,
          );
        } else {
          rootElement.style.removeProperty("will-change");
        }
        // Commit the restored transform while transitions are still disabled. Otherwise the
        // browser may batch this restoration with re-enabling the page's transition.
        root.getBoundingClientRect();
        if (previousTransition.value) {
          rootElement.style.setProperty(
            "transition",
            previousTransition.value,
            previousTransition.priority,
          );
        } else {
          rootElement.style.removeProperty("transition");
        }
      }
    } catch {
      // Fall back to viewport-difference geometry if styles cannot be changed or measured.
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
      position: style.position === "fixed" ? "fixed" : "absolute",
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
