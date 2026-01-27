export type MaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveMaskRect(this: Element | null): MaskRect | null {
  if (!this || typeof this.getBoundingClientRect !== "function") return null;
  const rect = this.getBoundingClientRect();
  if (!rect) return null;
  const style = window.getComputedStyle(this);
  if (!style) return null;
  if (style.visibility === "hidden" || style.display === "none") return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}
