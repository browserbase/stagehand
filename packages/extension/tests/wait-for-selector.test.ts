import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForSelector } from "../dom/locatorScripts/waitForSelector.js";

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }
}

type FakeDocument = {
  body: object | null;
  documentElement: object | null;
  querySelector: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function installDocument(): {
  document: FakeDocument;
  dispatchDOMContentLoaded: () => void;
} {
  let domContentLoadedHandler: (() => void) | undefined;
  const document = {
    body: null,
    documentElement: null,
    querySelector: vi.fn(() => null),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "DOMContentLoaded") domContentLoadedHandler = handler;
    }),
    removeEventListener: vi.fn(),
  };

  vi.stubGlobal("document", document);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);

  return {
    document,
    dispatchDOMContentLoaded: () => {
      expect(domContentLoadedHandler).toBeTypeOf("function");
      domContentLoadedHandler?.();
    },
  };
}

describe("waitForSelector", () => {
  afterEach(() => {
    FakeMutationObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it("resolves immediately when the selector already matches", async () => {
    const { document } = installDocument();
    document.body = {};
    document.querySelector.mockReturnValue({});

    await expect(waitForSelector("#target", "attached", 100, false)).resolves.toBe(true);

    expect(document.addEventListener).not.toHaveBeenCalled();
    expect(FakeMutationObserver.instances).toHaveLength(0);
  });

  it("checks again when DOMContentLoaded creates the document root", async () => {
    const { document, dispatchDOMContentLoaded } = installDocument();
    const result = waitForSelector("#target", "attached", 100, false);

    document.documentElement = {};
    document.querySelector.mockReturnValue({});
    expect(dispatchDOMContentLoaded).not.toThrow();

    await expect(result).resolves.toBe(true);
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "DOMContentLoaded",
      expect.any(Function),
    );
    expect(FakeMutationObserver.instances).toHaveLength(0);
  });

  it("observes mutations after DOMContentLoaded when the selector is still absent", async () => {
    const { document, dispatchDOMContentLoaded } = installDocument();
    const result = waitForSelector("#target", "attached", 100, false);

    document.documentElement = {};
    dispatchDOMContentLoaded();

    const observer = FakeMutationObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer?.observe).toHaveBeenCalledWith(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "disabled"],
    });

    document.querySelector.mockReturnValue({});
    observer?.callback([], observer as unknown as MutationObserver);

    await expect(result).resolves.toBe(true);
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });
});
