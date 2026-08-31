export const CURSOR_OVERLAY_SCRIPT = `(() => {
  const cursorId = "__browse_cursor_overlay__";
  const ensureCursor = () => {
    const existing = document.getElementById(cursorId);
    if (existing instanceof HTMLDivElement) return existing;

    const root = document.documentElement || document.body;
    if (!root) return null;

    const cursor = document.createElement("div");
    cursor.id = cursorId;
    cursor.setAttribute("aria-hidden", "true");
    Object.assign(cursor.style, {
      contain: "layout style paint",
      height: "24px",
      left: "0px",
      mixBlendMode: "normal",
      pointerEvents: "none",
      position: "fixed",
      top: "0px",
      userSelect: "none",
      width: "16px",
      willChange: "left,top",
      zIndex: "2147483647",
    });
    cursor.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><path d="M1 0 L1 22 L6 14 L15 14 Z" fill="black" stroke="white" stroke-width="0.7"/></svg>';
    root.appendChild(cursor);
    return cursor;
  };

  ensureCursor();
  if (!globalThis.__browseCursorOverlayListenerInstalled__) {
    document.addEventListener(
      "mousemove",
      (event) => {
        const cursor = ensureCursor();
        if (!cursor) return;
        cursor.style.left = Math.max(0, event.clientX) + "px";
        cursor.style.top = Math.max(0, event.clientY) + "px";
      },
      { capture: true },
    );
    globalThis.__browseCursorOverlayListenerInstalled__ = true;
  }
})()`;
