import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepLocatorDelegate, resolveLocatorTarget } from "./deepLocator.js";
import type { Frame } from "./frame.js";
import { FrameLocator } from "./frameLocator.js";
import type { Page } from "./page.js";
import { FrameSelectorResolver, type SelectorQuery } from "./selectorResolver.js";

// These fixtures describe the released string interpretation, including quirks.
// They are not the desired behavior of a new parser. Keep frame routing separate
// from engine parsing so a normalization refactor cannot silently conflate them.
describe("legacy selector engine normalization", () => {
  const cases: Array<{ name: string; input: string; query: SelectorQuery }> = [
    { name: "plain CSS", input: "button.submit", query: { kind: "css", value: "button.submit" } },
    {
      name: "outer whitespace",
      input: " \n button > span \t",
      query: { kind: "css", value: "button > span" },
    },
    { name: "CSS prefix", input: "CSS=button", query: { kind: "css", value: "button" } },
    {
      name: "whitespace after CSS prefix",
      input: "css=  button ",
      query: { kind: "css", value: "  button" },
    },
    {
      name: "explicit CSS beats XPath inference",
      input: "css=//button",
      query: { kind: "css", value: "//button" },
    },
    {
      name: "unknown prefix stays CSS",
      input: "role=button",
      query: { kind: "css", value: "role=button" },
    },
    {
      name: "slash in CSS attribute",
      input: 'a[href="/docs/start"]',
      query: { kind: "css", value: 'a[href="/docs/start"]' },
    },
    { name: "empty string", input: " \t", query: { kind: "css", value: "" } },
    { name: "empty CSS payload", input: "css=", query: { kind: "css", value: "" } },
    {
      name: "text prefix and whitespace",
      input: " TeXt=  Save changes  ",
      query: { kind: "text", value: "Save changes" },
    },
    {
      name: "double quoted text",
      input: 'text=" Save "',
      query: { kind: "text", value: " Save " },
    },
    { name: "single quoted text", input: "text='Save'", query: { kind: "text", value: "Save" } },
    {
      name: "mismatched quotes remain literal",
      input: `text="Save'`,
      query: { kind: "text", value: `"Save'` },
    },
    {
      name: "escaped quotes are not decoded",
      input: String.raw`text="Say \"Save\""`,
      query: { kind: "text", value: String.raw`Say \"Save\"` },
    },
    { name: "empty quoted text", input: 'text=""', query: { kind: "text", value: "" } },
    {
      name: "text with slashes",
      input: 'text="https://example.com/a/b"',
      query: { kind: "text", value: "https://example.com/a/b" },
    },
    {
      name: "text hop literal at engine boundary",
      input: 'text="a >> b"',
      query: { kind: "text", value: "a >> b" },
    },
    {
      name: "absolute XPath",
      input: "/html/body/button[2]",
      query: { kind: "xpath", value: "/html/body/button[2]" },
    },
    { name: "descendant XPath", input: "//button", query: { kind: "xpath", value: "//button" } },
    {
      name: "parenthesized XPath",
      input: "(//button)[2]",
      query: { kind: "xpath", value: "(//button)[2]" },
    },
    {
      name: "case-insensitive XPath prefix",
      input: "XpAtH=//iframe//button",
      query: { kind: "xpath", value: "//iframe//button" },
    },
    {
      name: "whitespace after XPath prefix",
      input: "xpath=  .//button ",
      query: { kind: "xpath", value: "  .//button" },
    },
    {
      name: "relative XPath requires a prefix",
      input: ".//button",
      query: { kind: "css", value: ".//button" },
    },
    {
      name: "explicit relative XPath",
      input: "xpath=.//button",
      query: { kind: "xpath", value: ".//button" },
    },
    {
      name: "malformed XPath is not validated here",
      input: "xpath=//button[",
      query: { kind: "xpath", value: "//button[" },
    },
    { name: "empty XPath payload", input: "xpath=", query: { kind: "xpath", value: "" } },
    // Frame routing handles these strings differently; see the next suite.
    {
      name: "CSS hops become descendant spaces at engine boundary",
      input: "iframe >> button",
      query: { kind: "css", value: "iframe button" },
    },
    {
      name: "CSS hop splitting is not quote-aware",
      input: 'css=[data-label="a >> b"]',
      query: { kind: "css", value: '[data-label="a b"]' },
    },
    {
      name: "empty CSS hop segments are discarded",
      input: " >> iframe >> >> button >> ",
      query: { kind: "css", value: "iframe button" },
    },
  ];

  it.each(cases)("$name", ({ input, query }) => {
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

  const cases: Array<{ name: string; input: string; hops: string[]; selector: string }> = [
    {
      name: "ordinary CSS stays in the current frame",
      input: " css=button ",
      hops: [],
      selector: "css=button",
    },
    {
      name: "text slash literals stay intact",
      input: 'text="https://example.com/a/b"',
      hops: [],
      selector: 'text="https://example.com/a/b"',
    },
    {
      name: "one explicit iframe hop",
      input: " iframe.checkout >> css=button ",
      hops: ["iframe.checkout"],
      selector: "css=button",
    },
    {
      name: "nested explicit iframe hops",
      input: "#outer >> iframe.inner >> text='Pay'",
      hops: ["#outer", "iframe.inner"],
      selector: "text='Pay'",
    },
    {
      name: "empty hop segments are ignored when multiple segments remain",
      input: " >> #outer >> >> #inner >> button >> ",
      hops: ["#outer", "#inner"],
      selector: "button",
    },
    {
      name: "a single remaining hop segment leaves the original string",
      input: " >> button >> ",
      hops: [],
      selector: ">> button >>",
    },
    {
      name: "empty input is not validated at this boundary",
      input: " \t ",
      hops: [],
      selector: "",
    },
    {
      name: "quoted text is still split on hop delimiters",
      input: 'text="a >> b"',
      hops: ['text="a'],
      selector: 'b"',
    },
    {
      name: "quoted CSS attributes are still split on hop delimiters",
      input: '[data-label="a >> b"]',
      hops: ['[data-label="a'],
      selector: 'b"]',
    },
    {
      name: "generated indexed iframe XPath",
      input: "/html/body/iframe[2]/html/body/button[3]",
      hops: ["xpath=/html/body/iframe[2]"],
      selector: "xpath=/html/body/button[3]",
    },
    {
      name: "nested frame XPath preserves descendant axes",
      input: "xpath=//iframe[2]//frame[1]//button[3]",
      hops: ["xpath=//iframe[2]", "xpath=//frame[1]"],
      selector: "xpath=//button[3]",
    },
    {
      name: "trailing iframe is an element target",
      input: "xpath=/html/body/iframe[2]",
      hops: [],
      selector: "xpath=/html/body/iframe[2]",
    },
    {
      name: "trailing frame after a hop remains a child-frame element",
      input: "//iframe[2]//frame[1]",
      hops: ["xpath=//iframe[2]"],
      selector: "xpath=//frame[1]",
    },
    {
      name: "shadow-hop XPath does not imply a frame hop",
      input: "xpath=/html/body/my-widget//button",
      hops: [],
      selector: "xpath=/html/body/my-widget//button",
    },
    {
      name: "XPath predicates retain slash literals",
      input: "xpath=//a[@href='/docs/start']",
      hops: [],
      selector: "xpath=//a[@href='/docs/start']",
    },
    {
      name: "attribute-qualified iframe is not recognized as a hop",
      input: "xpath=//iframe[@id='checkout']//button",
      hops: [],
      selector: "xpath=//iframe[@id='checkout']//button",
    },
    {
      name: "uppercase XPath prefix bypasses frame planning",
      input: "XPATH=//iframe//button",
      hops: [],
      selector: "XPATH=//iframe//button",
    },
    {
      name: "unprefixed parenthesized XPath bypasses frame planning",
      input: "(//iframe)[2]//button",
      hops: [],
      selector: "(//iframe)[2]//button",
    },
    {
      name: "prefixed relative XPath gains a leading slash",
      input: "xpath=.//button",
      hops: [],
      selector: "xpath=/.//button",
    },
    {
      name: "explicit hops take precedence over deep XPath in the final segment",
      input: "#outer >> xpath=//iframe//button",
      hops: ["#outer"],
      selector: "xpath=//iframe//button",
    },
    {
      name: "malformed XPath is passed on for evaluation",
      input: "xpath=//button[",
      hops: [],
      selector: "xpath=//button[",
    },
    {
      name: "empty XPath payload becomes the root path",
      input: "xpath=",
      hops: [],
      selector: "xpath=/",
    },
  ];

  it.each(cases)("$name", async ({ input, hops, selector }) => {
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
