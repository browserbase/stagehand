import { afterEach, describe, expect, it, vi } from "vitest";

type FakeElement = {
  dataset: Record<string, string>;
  id: string;
  isConnected: boolean;
  append: (...children: FakeElement[]) => void;
  attachShadow: () => { append: (...children: FakeElement[]) => void };
  innerHTML: string;
  setAttribute: (name: string, value: string) => void;
  textContent: string;
};

function createFakeElement(): FakeElement {
  return {
    dataset: {},
    id: "",
    isConnected: false,
    append: vi.fn(),
    attachShadow: () => ({ append: vi.fn() }),
    innerHTML: "",
    setAttribute: vi.fn(),
    textContent: "",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("agent indicator DOM state", () => {
  it("reports the installed host only while it is attached", async () => {
    const host = createFakeElement();
    const root = {
      appendChild(element: FakeElement) {
        element.isConnected = true;
      },
    };
    const document = {
      body: null,
      createElement: vi.fn(() => createFakeElement()),
      documentElement: root,
      head: null,
    };
    document.createElement.mockReturnValueOnce(host);
    vi.stubGlobal("document", document);

    const { installAgentIndicator, isAgentIndicatorHost, isAgentIndicatorInstalled } =
      await import("../dom/agentIndicator.ts");

    expect(isAgentIndicatorInstalled()).toBe(false);
    expect(installAgentIndicator()).toBe(true);
    expect(isAgentIndicatorInstalled()).toBe(true);
    expect(isAgentIndicatorHost(host as unknown as Element)).toBe(true);

    host.isConnected = false;

    expect(isAgentIndicatorInstalled()).toBe(false);
    expect(isAgentIndicatorHost(host as unknown as Element)).toBe(true);
  });
});
