import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { CURSOR_OVERLAY_SCRIPT } from "../src/lib/driver/cursor-overlay.js";

describe("cursor overlay", () => {
  it("installs after DOMContentLoaded when the document root is not ready", () => {
    class FakeDiv {
      id = "";
      innerHTML = "";
      style: Record<string, string> = {};

      setAttribute(): void {}
    }

    const elements = new Map<string, FakeDiv>();
    const listeners = new Map<string, () => void>();
    let documentElement: { appendChild: (element: FakeDiv) => void } | null =
      null;
    const document = {
      addEventListener: vi.fn((name: string, listener: () => void) => {
        listeners.set(name, listener);
      }),
      body: null,
      createElement: vi.fn(() => new FakeDiv()),
      get documentElement() {
        return documentElement;
      },
      getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    };

    runInNewContext(`globalThis.top = globalThis;\n${CURSOR_OVERLAY_SCRIPT}`, {
      document,
      HTMLDivElement: FakeDiv,
    });

    expect(elements.size).toBe(0);
    expect(listeners.has("DOMContentLoaded")).toBe(true);

    documentElement = {
      appendChild(element) {
        elements.set(element.id, element);
      },
    };
    listeners.get("DOMContentLoaded")!();

    expect(elements.get("__browse_cursor_overlay__")).toBeInstanceOf(FakeDiv);
  });
});
