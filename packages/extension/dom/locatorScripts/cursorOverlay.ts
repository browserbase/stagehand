const CURSOR_OVERLAY_ID = "__v3_cursor_overlay__";

let cursorElement: HTMLDivElement | null = null;
let pendingPosition: readonly [number, number] | null = null;
let installScheduled = false;

function positionCursor(element: HTMLDivElement, x: number, y: number): void {
  element.style.left = `${Math.max(0, x)}px`;
  element.style.top = `${Math.max(0, y)}px`;
}

function scheduleInstall(): void {
  if (installScheduled) return;
  installScheduled = true;

  const retry = () => {
    installScheduled = false;
    installCursorOverlay();
  };
  document.addEventListener("DOMContentLoaded", retry, { once: true });
  globalThis.setTimeout(retry, 100);
}

export function installCursorOverlay(): boolean {
  try {
    if (cursorElement?.isConnected) return true;

    const existing = document.getElementById(CURSOR_OVERLAY_ID);
    if (existing instanceof HTMLDivElement) {
      cursorElement = existing;
    } else {
      const root = document.documentElement ?? document.body ?? document.head;
      if (!root) {
        scheduleInstall();
        return false;
      }

      const element = document.createElement("div");
      element.id = CURSOR_OVERLAY_ID;
      element.style.position = "fixed";
      element.style.left = "0px";
      element.style.top = "0px";
      element.style.width = "16px";
      element.style.height = "24px";
      element.style.zIndex = "2147483647";
      element.style.pointerEvents = "none";
      element.style.userSelect = "none";
      element.style.mixBlendMode = "normal";
      element.style.contain = "layout style paint";
      element.style.willChange = "transform,left,top";
      element.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><path d="M1 0 L1 22 L6 14 L15 14 Z" fill="black" stroke="white" stroke-width="0.7"/></svg>';
      root.appendChild(element);
      cursorElement = element;
    }

    if (pendingPosition) {
      positionCursor(cursorElement, pendingPosition[0], pendingPosition[1]);
      pendingPosition = null;
    }
    return true;
  } catch {
    return false;
  }
}

export function moveCursorOverlay(x: number, y: number): boolean {
  pendingPosition = [x, y];
  if (!installCursorOverlay() || !cursorElement) return false;
  positionCursor(cursorElement, x, y);
  pendingPosition = null;
  return true;
}
