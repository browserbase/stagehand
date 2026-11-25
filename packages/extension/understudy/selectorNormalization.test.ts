import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepLocatorDelegate, resolveLocatorTarget } from "./deepLocator.js";
import type { Frame } from "./frame.js";
import { FrameLocator } from "./frameLocator.js";
import type { Page } from "./page.js";
import { FrameSelectorResolver } from "./selectorResolver.js";
import { legacyEngineCases, legacyRoutingCases } from "./fixtures/legacySelectors.js";

// These fixtures describe the released string interpretation, including quirks.
// They are not the desired behavior of a new parser. Keep frame routing separate
// from engine parsing so a normalization refactor cannot silently conflate them.
describe("legacy selector engine normalization", () => {
  it.each(legacyEngineCases)("$name", ({ input, query }) => {
    expect(FrameSelectorResolver.parseSelector(input)).toEqual(query);
  });
});

describe("legacy selector frame routing", () => {
  afterEach(() => vi.restoreAllMocks());

  // Only frame discovery is stubbed. The actual string routing, XPath hop
  // planning, and Locator construction remain under test; no browser is needed.
  function createRoutingContext() {
    const root = { frameId: "root" } as Frame;
    const child = { frameId: "child" } as Frame;
    const page = {} as Page;
    const hops: string[] = [];
    const resolveFrame = vi
      .spyOn(FrameLocator.prototype, "resolveFrame")
      .mockImplementation(async function (this: FrameLocator) {
        const selectors = [this.selector];
        if (!this.parent) expect(this.root).toBe(root);
        let ancestor = this.parent;
        while (ancestor) {
          selectors.unshift(ancestor.selector);
          if (!ancestor.parent) expect(ancestor.root).toBe(root);
          ancestor = ancestor.parent;
        }
        hops.push(...selectors);
        return child;
      });
    return { root, child, page, hops, resolveFrame };
  }

  it.each(legacyRoutingCases)("$name", async ({ input, hops, selector }) => {
    const context = createRoutingContext();
    const target = await resolveLocatorTarget(context.page, context.root, input);

    expect(context.hops).toEqual(hops);
    expect(context.resolveFrame).toHaveBeenCalledTimes(hops.length ? 1 : 0);
    expect(target.frame).toBe(hops.length ? context.child : context.root);
    expect(target.selector).toBe(selector);
  });

  it.each([
    {
      input: "iframe:nth-child(2) >> button:nth-child(3)",
      hops: ["iframe:nth-child(2)"],
      query: { kind: "css", value: "button:nth-child(3)" },
    },
    {
      input: "xpath=//iframe[2]//button[3]",
      hops: ["xpath=//iframe[2]"],
      query: { kind: "xpath", value: "//button[3]" },
    },
  ])(
    "applies nth to the final target, preserving embedded indices: $input",
    async ({ input, hops, query }) => {
      const context = createRoutingContext();
      const delegate = new DeepLocatorDelegate(context.page, context.root, input);

      for (const [selection, expectedIndex] of [
        [delegate, -1],
        [delegate.first(), 0],
        [delegate.nth(4), 4],
      ] as const) {
        context.hops.length = 0;
        const target = await selection.real();
        expect(context.hops).toEqual(hops);
        expect(target.getFrame()).toBe(context.child);
        expect(target.selectorQuery).toEqual(query);
        expect(target.nthIndex).toBe(expectedIndex);
      }
      expect(delegate.nthIndex).toBe(-1);
    },
  );

  it("floors fractional internal indices without changing the original delegate", () => {
    const { page, root } = createRoutingContext();
    const delegate = new DeepLocatorDelegate(page, root, "button");
    expect(delegate.nth(2.9).nthIndex).toBe(2);
    expect(delegate.nthIndex).toBe(-1);
  });

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid internal nth index %s", (index) => {
    const { page, root } = createRoutingContext();
    const delegate = new DeepLocatorDelegate(page, root, "button");
    expect(() => delegate.nth(index)).toThrow(
      new RangeError("deepLocator().nth() expects a non-negative index"),
    );
  });
});
