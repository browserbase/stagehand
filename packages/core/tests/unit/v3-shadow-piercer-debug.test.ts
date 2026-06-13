import { afterEach, describe, expect, it, vi } from "vitest";
import { installV3ShadowPiercer } from "../../lib/v3/dom/piercer.runtime.js";

function installFakeDom() {
  class TestElement {
    tagName: string;
    shadowRoot?: unknown;

    constructor(tagName = "x-host") {
      this.tagName = tagName.toUpperCase();
    }

    attachShadow(init: ShadowRootInit): ShadowRoot {
      const root = { mode: init.mode ?? "open" };
      if ((init.mode ?? "open") === "open") {
        this.shadowRoot = root;
      }
      return root as ShadowRoot;
    }
  }

  const fakeWindow: Record<string, unknown> = {};
  fakeWindow.top = fakeWindow;

  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", {
    readyState: "complete",
    createTreeWalker: vi.fn(),
  });
  vi.stubGlobal("location", { href: "https://example.test/" });
  vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1 });

  return { TestElement, fakeWindow };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("installV3ShadowPiercer debug option", () => {
  it("does not emit piercer console logs when debug is omitted", () => {
    const { TestElement } = installFakeDom();
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer();
    new TestElement().attachShadow({ mode: "open" });

    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("updates the idempotent install debug state from opts.debug", () => {
    const { TestElement } = installFakeDom();
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer({ debug: false });
    installV3ShadowPiercer({ debug: true });
    new TestElement("x-enabled").attachShadow({ mode: "closed" });

    expect(consoleInfo).toHaveBeenCalledWith(
      "[v3-piercer] attachShadow",
      expect.objectContaining({ tag: "x-enabled", mode: "closed" }),
    );
  });
});
