import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installV3ShadowPiercer } from "../../lib/v3/dom/piercer.runtime.js";

const originalGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  Element: globalThis.Element,
  NodeFilter: globalThis.NodeFilter,
  location: globalThis.location,
};

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.com/",
  });

  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  vi.stubGlobal("location", dom.window.location);

  return dom;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Reflect.set(globalThis, key, value);
    }
  }
});

describe("installV3ShadowPiercer debug option", () => {
  it("does not log by default", () => {
    installDom();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer();
    document.createElement("div").attachShadow({ mode: "closed" });

    expect(info).not.toHaveBeenCalled();
  });

  it("logs install and attachShadow events when debug is true", () => {
    installDom();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer({ debug: true });
    document.createElement("div").attachShadow({ mode: "open" });

    expect(info).toHaveBeenCalledWith(
      "[v3-piercer] installed",
      expect.objectContaining({ url: "https://example.com/" }),
    );
    expect(info).toHaveBeenCalledWith(
      "[v3-piercer] attachShadow",
      expect.objectContaining({ tag: "div", mode: "open" }),
    );
  });

  it("updates debug state on repeated install calls", () => {
    installDom();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer({ debug: true });
    installV3ShadowPiercer({ debug: false });
    info.mockClear();

    document.createElement("div").attachShadow({ mode: "closed" });

    expect(info).not.toHaveBeenCalled();
  });
});
