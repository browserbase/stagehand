import { afterEach, describe, expect, it, vi } from "vitest";

import { installV3ShadowPiercer } from "../../lib/v3/dom/piercer.runtime";

class TestElement {
  tagName = "TEST-ELEMENT";

  attachShadow(_init: ShadowRootInit): ShadowRoot {
    return {} as ShadowRoot;
  }
}

function installDomGlobals() {
  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("location", { href: "https://example.com" });
  vi.stubGlobal("window", {
    top: undefined,
    __stagehandV3Injected: undefined,
    __stagehandV3__: undefined,
  });
  window.top = window;
}

describe("installV3ShadowPiercer debug logging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not log by default", () => {
    installDomGlobals();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer();
    new TestElement().attachShadow({ mode: "closed" });

    expect(info).not.toHaveBeenCalled();
  });

  it("logs when debug is enabled", () => {
    installDomGlobals();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    installV3ShadowPiercer({ debug: true });
    new TestElement().attachShadow({ mode: "closed" });

    expect(info).toHaveBeenCalled();
  });
});
