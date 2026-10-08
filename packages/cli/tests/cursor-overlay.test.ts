import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { CURSOR_OVERLAY_SCRIPT } from "../src/lib/driver/cursor-overlay.js";

describe("cursor overlay", () => {
  it("installs after DOMContentLoaded when the document root is not ready", () => {
    const harness = createCursorHarness({ ready: false });

    harness.install();

    expect(harness.elements.size).toBe(0);
    expect(harness.listeners.has("DOMContentLoaded")).toBe(true);

    harness.makeDocumentReady();
    harness.listeners.get("DOMContentLoaded")!();

    expect(harness.cursor()).toBeInstanceOf(FakeDiv);
  });

  it("installs a click-through cursor once in an already-ready document", () => {
    const harness = createCursorHarness();

    harness.install();

    expect(harness.cursor()?.style).toMatchObject({
      left: "0px",
      pointerEvents: "none",
      position: "fixed",
      top: "0px",
      zIndex: "2147483647",
    });
    expect(harness.listeners.has("DOMContentLoaded")).toBe(false);
    expect(harness.listeners.has("mousemove")).toBe(true);

    harness.install();

    expect(harness.document.createElement).toHaveBeenCalledOnce();
    expect(harness.document.addEventListener).toHaveBeenCalledOnce();
    expect(harness.elements.size).toBe(1);
  });

  it("moves and clamps the cursor from top-document mouse events", () => {
    const harness = createCursorHarness();
    harness.install();

    const mousemove = harness.listeners.get("mousemove")!;
    mousemove({ clientX: -25, clientY: 80 });
    expect(harness.cursor()?.style).toMatchObject({
      left: "0px",
      top: "80px",
    });

    mousemove({ clientX: 140, clientY: -10 });
    expect(harness.cursor()?.style).toMatchObject({
      left: "140px",
      top: "0px",
    });
  });

  it("does not install inside a child frame", () => {
    const harness = createCursorHarness({ topFrame: false });

    harness.install();

    expect(harness.elements.size).toBe(0);
    expect(harness.document.createElement).not.toHaveBeenCalled();
    expect(harness.document.addEventListener).not.toHaveBeenCalled();
  });
});

class FakeDiv {
  id = "";
  innerHTML = "";
  style: Record<string, string> = {};

  setAttribute(): void {}
}

type CursorEvent = { clientX: number; clientY: number };
type CursorListener = (event?: CursorEvent) => void;

function createCursorHarness(
  options: { ready?: boolean; topFrame?: boolean } = {},
) {
  const elements = new Map<string, FakeDiv>();
  const listeners = new Map<string, CursorListener>();
  const root = {
    appendChild(element: FakeDiv) {
      elements.set(element.id, element);
    },
  };
  let documentElement: typeof root | null =
    options.ready === false ? null : root;
  const document = {
    addEventListener: vi.fn((name: string, listener: CursorListener) => {
      listeners.set(name, listener);
    }),
    body: null,
    createElement: vi.fn(() => new FakeDiv()),
    get documentElement() {
      return documentElement;
    },
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
  };
  const context = createContext({ document, HTMLDivElement: FakeDiv });
  runInContext(
    `globalThis.top = ${options.topFrame === false ? "{}" : "globalThis"}`,
    context,
  );

  return {
    cursor: () => elements.get("__browse_cursor_overlay__"),
    document,
    elements,
    install: () => runInContext(CURSOR_OVERLAY_SCRIPT, context),
    listeners,
    makeDocumentReady: () => {
      documentElement = root;
    },
  };
}
