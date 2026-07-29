import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@browserbasehq/stagehand";
import { selectorsResolveToSameElement } from "../../framework/observeSelectors.js";

const first = {};
const second = {};

function buildPage(): Page {
  return {
    evaluate: vi.fn(async (fn, arg) => fn(arg)),
  } as unknown as Page;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectorsResolveToSameElement", () => {
  it("matches CSS selectors that resolve to the same element", async () => {
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === "#observed" || selector === "[data-match]" ? first : second,
      evaluate: vi.fn(),
    });
    vi.stubGlobal("XPathResult", { FIRST_ORDERED_NODE_TYPE: 9 });

    await expect(
      selectorsResolveToSameElement(buildPage(), "#observed", ["#other", "[data-match]"]),
    ).resolves.toBe(true);
  });

  it.each(["/html/body/button", "xpath=/html/body/button", "(//button)[1]"])(
    "matches supported XPath form %s",
    async (observedSelector) => {
      vi.stubGlobal("document", {
        querySelector: (selector: string) => (selector === "#candidate" ? first : null),
        evaluate: () => ({ singleNodeValue: first }),
      });
      vi.stubGlobal("XPathResult", { FIRST_ORDERED_NODE_TYPE: 9 });

      await expect(
        selectorsResolveToSameElement(buildPage(), observedSelector, ["#candidate"]),
      ).resolves.toBe(true);
    },
  );

  it("returns null for unresolved and nonmatching selectors", async () => {
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector === "#observed") return first;
        if (selector === "#other") return second;
        return null;
      },
      evaluate: (): { singleNodeValue: object | null } => ({ singleNodeValue: null }),
    });
    vi.stubGlobal("XPathResult", { FIRST_ORDERED_NODE_TYPE: 9 });

    await expect(
      selectorsResolveToSameElement(buildPage(), "#missing", ["#observed"]),
    ).resolves.toBe(false);
    await expect(
      selectorsResolveToSameElement(buildPage(), "#observed", ["#other", "#missing"]),
    ).resolves.toBe(false);
  });

  it("treats malformed selectors as unresolved and continues matching", async () => {
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector === "[") throw new SyntaxError("Invalid CSS selector");
        if (selector === "#observed" || selector === "#candidate") return first;
        return null;
      },
      evaluate: () => {
        throw new DOMException("Invalid XPath expression");
      },
    });
    vi.stubGlobal("XPathResult", { FIRST_ORDERED_NODE_TYPE: 9 });

    await expect(
      selectorsResolveToSameElement(buildPage(), "#observed", ["[", "xpath=(", "#candidate"]),
    ).resolves.toBe(true);
    await expect(selectorsResolveToSameElement(buildPage(), "[", ["#candidate"])).resolves.toBe(
      false,
    );
    await expect(
      selectorsResolveToSameElement(buildPage(), "xpath=(", ["#candidate"]),
    ).resolves.toBe(false);
  });
});
