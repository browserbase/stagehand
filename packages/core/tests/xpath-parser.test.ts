import { describe, expect, it } from "vitest";
import {
  applyPredicates,
  elementMatchesStep,
  parseXPathSteps,
  type XPathPredicate,
  type XPathStep,
} from "../lib/v3/dom/locatorScripts/xpathParser";

describe("parseXPathSteps", () => {
  describe("basic tag parsing", () => {
    it("parses a simple absolute path", () => {
      expect(parseXPathSteps("/html/body/div")).toEqual([
        { axis: "child", tag: "html", predicates: [] },
        { axis: "child", tag: "body", predicates: [] },
        { axis: "child", tag: "div", predicates: [] },
      ]);
    });

    it("lowercases tag names", () => {
      const steps = parseXPathSteps("/HTML/BODY");
      expect(steps[0].tag).toBe("html");
      expect(steps[1].tag).toBe("body");
    });

    it("treats wildcard correctly", () => {
      const steps = parseXPathSteps("//*");
      expect(steps).toEqual([{ axis: "desc", tag: "*", predicates: [] }]);
    });
  });

  describe("axes", () => {
    it("distinguishes child (/) from descendant (//)", () => {
      const steps = parseXPathSteps("/html//div/span");
      expect(steps).toEqual([
        { axis: "child", tag: "html", predicates: [] },
        { axis: "desc", tag: "div", predicates: [] },
        { axis: "child", tag: "span", predicates: [] },
      ]);
    });

    it("handles leading //", () => {
      const steps = parseXPathSteps("//div");
      expect(steps[0].axis).toBe("desc");
    });
  });

  describe("positional indices", () => {
    it("parses positional index", () => {
      const steps = parseXPathSteps("/div[1]/span[3]");
      expect(steps[0]).toMatchObject({
        tag: "div",
        predicates: [{ type: "index", index: 1 }],
      });
      expect(steps[1]).toMatchObject({
        tag: "span",
        predicates: [{ type: "index", index: 3 }],
      });
    });

    it("clamps index to minimum 1", () => {
      const steps = parseXPathSteps("/div[0]");
      expect(steps[0].predicates[0]).toMatchObject({
        type: "index",
        index: 1,
      });
    });

    it("keeps multiple positional predicates in order", () => {
      const steps = parseXPathSteps("//div[2][3]");
      expect(steps[0].predicates).toEqual([
        { type: "index", index: 2 },
        { type: "index", index: 3 },
      ]);
    });
  });

  describe("attribute predicates", () => {
    it("parses single attribute predicate with single quotes", () => {
      const steps = parseXPathSteps("//img[@alt='Stagehand']");
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "img",
          predicates: [{ type: "attrEquals", name: "alt", value: "Stagehand" }],
        },
      ]);
    });

    it("parses single attribute predicate with double quotes", () => {
      const steps = parseXPathSteps('//img[@alt="Stagehand"]');
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "alt", value: "Stagehand" },
      ]);
    });

    it("parses multiple attribute predicates", () => {
      const steps = parseXPathSteps("//div[@class='foo'][@id='bar']");
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "class", value: "foo" },
        { type: "attrEquals", name: "id", value: "bar" },
      ]);
    });

    it("parses attribute predicate combined with positional index", () => {
      const steps = parseXPathSteps("//div[@class='item'][2]");
      expect(steps[0]).toMatchObject({
        tag: "div",
        predicates: [
          { type: "attrEquals", name: "class", value: "item" },
          { type: "index", index: 2 },
        ],
      });
    });

    it("parses attribute with hyphenated name", () => {
      const steps = parseXPathSteps("//div[@data-testid='submit']");
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "data-testid", value: "submit" },
      ]);
    });

    it("parses attribute with empty value", () => {
      const steps = parseXPathSteps("//input[@value='']");
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "value", value: "" },
      ]);
    });

    it("parses attribute value containing closing bracket", () => {
      const steps = parseXPathSteps("//div[@title='array[0]']");
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "title", value: "array[0]" },
      ]);
    });

    it("parses attribute value containing multiple brackets", () => {
      const steps = parseXPathSteps("//div[@data-json='[1,2,3]']");
      expect(steps[0].predicates).toEqual([
        { type: "attrEquals", name: "data-json", value: "[1,2,3]" },
      ]);
    });

    it("parses attribute value containing a closing bracket", () => {
      // The step splitter should ignore ] characters inside quotes.
      const steps = parseXPathSteps("//div[@title='a]b']/span");
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "div",
          predicates: [{ type: "attrEquals", name: "title", value: "a]b" }],
        },
        { axis: "child", tag: "span", predicates: [] },
      ]);
    });

    it("parses attribute existence predicates", () => {
      const steps = parseXPathSteps("//iframe[@data-test]");
      expect(steps[0].predicates).toEqual([
        { type: "attrExists", name: "data-test" },
      ]);
    });

    it("parses attribute contains predicates", () => {
      const steps = parseXPathSteps("//iframe[contains(@src,'checkout')]");
      expect(steps[0].predicates).toEqual([
        { type: "attrContains", name: "src", value: "checkout" },
      ]);
    });

    it("parses attribute starts-with predicates", () => {
      const steps = parseXPathSteps("//button[starts-with(@id,'save-')]");
      expect(steps[0].predicates).toEqual([
        { type: "attrStartsWith", name: "id", value: "save-" },
      ]);
    });
  });

  describe("text predicates", () => {
    it("parses text equality", () => {
      const steps = parseXPathSteps("//button[text()='Submit']");
      expect(steps[0].predicates).toEqual([
        { type: "textEquals", value: "Submit" },
      ]);
    });

    it("parses text contains", () => {
      const steps = parseXPathSteps("//div[contains(text(),'Welcome')]");
      expect(steps[0].predicates).toEqual([
        { type: "textContains", value: "Welcome" },
      ]);
    });

    it("parses normalize-space on text", () => {
      const steps = parseXPathSteps(
        "//div[normalize-space(text())='Hello world']",
      );
      expect(steps[0].predicates).toEqual([
        { type: "textEquals", value: "Hello world", normalize: true },
      ]);
    });
  });

  describe("boolean predicates", () => {
    it("parses and predicates", () => {
      const steps = parseXPathSteps("//div[@a='x' and @b='y']");
      expect(steps[0].predicates).toEqual([
        {
          type: "and",
          predicates: [
            { type: "attrEquals", name: "a", value: "x" },
            { type: "attrEquals", name: "b", value: "y" },
          ],
        },
      ]);
    });

    it("parses operators without surrounding whitespace", () => {
      const steps = parseXPathSteps("//div[not(@x)and@y='z']");
      expect(steps[0].predicates).toEqual([
        {
          type: "and",
          predicates: [
            { type: "not", predicate: { type: "attrExists", name: "x" } },
            { type: "attrEquals", name: "y", value: "z" },
          ],
        },
      ]);
    });

    it("parses or predicates", () => {
      const steps = parseXPathSteps("//div[@a='x' or @b='y']");
      expect(steps[0].predicates).toEqual([
        {
          type: "or",
          predicates: [
            { type: "attrEquals", name: "a", value: "x" },
            { type: "attrEquals", name: "b", value: "y" },
          ],
        },
      ]);
    });

    it("parses not predicates", () => {
      const steps = parseXPathSteps("//button[not(@disabled)]");
      expect(steps[0].predicates).toEqual([
        { type: "not", predicate: { type: "attrExists", name: "disabled" } },
      ]);
    });

    it("does not treat @and as a boolean operator", () => {
      const steps = parseXPathSteps("//div[@and='x' and @y='z']");
      expect(steps[0].predicates).toEqual([
        {
          type: "and",
          predicates: [
            { type: "attrEquals", name: "and", value: "x" },
            { type: "attrEquals", name: "y", value: "z" },
          ],
        },
      ]);
    });
  });

  describe("multi-step with predicates", () => {
    it("parses complex path with mixed predicates", () => {
      const steps = parseXPathSteps(
        "/html/body//div[@class='container']/ul/li[3]",
      );
      expect(steps).toEqual([
        { axis: "child", tag: "html", predicates: [] },
        { axis: "child", tag: "body", predicates: [] },
        {
          axis: "desc",
          tag: "div",
          predicates: [
            { type: "attrEquals", name: "class", value: "container" },
          ],
        },
        { axis: "child", tag: "ul", predicates: [] },
        { axis: "child", tag: "li", predicates: [{ type: "index", index: 3 }] },
      ]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(parseXPathSteps("")).toEqual([]);
    });

    it("strips xpath= prefix", () => {
      const steps = parseXPathSteps("xpath=//div");
      expect(steps).toEqual([{ axis: "desc", tag: "div", predicates: [] }]);
    });

    it("strips XPATH= prefix (case-insensitive)", () => {
      const steps = parseXPathSteps("XPATH=//div");
      expect(steps).toEqual([{ axis: "desc", tag: "div", predicates: [] }]);
    });

    it("handles forward slashes inside attribute values", () => {
      const steps = parseXPathSteps("//a[@href='/api/endpoint']");
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "a",
          predicates: [
            { type: "attrEquals", name: "href", value: "/api/endpoint" },
          ],
        },
      ]);
    });

    it("handles URL attribute values with multiple slashes", () => {
      const steps = parseXPathSteps(
        "//a[@data-url='http://example.com/path/to/page']",
      );
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "a",
          predicates: [
            {
              type: "attrEquals",
              name: "data-url",
              value: "http://example.com/path/to/page",
            },
          ],
        },
      ]);
    });

    it("handles whitespace", () => {
      const steps = parseXPathSteps("  //div  ");
      expect(steps.length).toBe(1);
      expect(steps[0].tag).toBe("div");
    });
  });
});

describe("elementMatchesStep", () => {
  const makeElement = (
    localName: string,
    attributes: Record<string, string> = {},
    textContent = "",
  ): Element => {
    return {
      localName,
      textContent,
      getAttribute: (name: string) => attributes[name] ?? null,
    } as unknown as Element;
  };

  it("matches by tag name", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      predicates: [],
    };
    expect(elementMatchesStep(makeElement("div"), step)).toBe(true);
    expect(elementMatchesStep(makeElement("span"), step)).toBe(false);
  });

  it("wildcard matches any element", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "*",
      predicates: [],
    };
    expect(elementMatchesStep(makeElement("div"), step)).toBe(true);
    expect(elementMatchesStep(makeElement("span"), step)).toBe(true);
  });

  it("matches attribute predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "img",
      predicates: [{ type: "attrEquals", name: "alt", value: "Stagehand" }],
    };
    expect(
      elementMatchesStep(makeElement("img", { alt: "Stagehand" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("img", { alt: "Other" }), step)).toBe(
      false,
    );
    expect(elementMatchesStep(makeElement("img"), step)).toBe(false);
  });

  it("matches attribute existence predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      predicates: [{ type: "attrExists", name: "data-test" }],
    };
    expect(
      elementMatchesStep(makeElement("div", { "data-test": "y" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("div", {}), step)).toBe(false);
  });

  it("matches attribute contains predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "a",
      predicates: [{ type: "attrContains", name: "href", value: "checkout" }],
    };
    expect(
      elementMatchesStep(makeElement("a", { href: "/shop/checkout" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("a", { href: "/blog" }), step)).toBe(
      false,
    );
  });

  it("matches text predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "button",
      predicates: [{ type: "textEquals", value: "Submit" }],
    };
    expect(elementMatchesStep(makeElement("button", {}, "Submit"), step)).toBe(
      true,
    );
    expect(
      elementMatchesStep(makeElement("button", {}, "Submit now"), step),
    ).toBe(false);
  });

  it("matches normalize-space text predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      predicates: [
        { type: "textEquals", value: "Hello world", normalize: true },
      ],
    };
    expect(
      elementMatchesStep(makeElement("div", {}, "  Hello   world \n"), step),
    ).toBe(true);
  });

  it("matches boolean predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      predicates: [
        {
          type: "and",
          predicates: [
            { type: "attrEquals", name: "a", value: "x" },
            { type: "attrEquals", name: "b", value: "y" },
          ],
        },
      ],
    };
    expect(
      elementMatchesStep(makeElement("div", { a: "x", b: "y" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("div", { a: "x" }), step)).toBe(
      false,
    );
  });

  it("requires all attribute predicates to match", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      predicates: [
        { type: "attrEquals", name: "class", value: "foo" },
        { type: "attrEquals", name: "id", value: "bar" },
      ],
    };
    expect(
      elementMatchesStep(makeElement("div", { class: "foo", id: "bar" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("div", { class: "foo" }), step)).toBe(
      false,
    );
  });

  it("checks tag name before attributes", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "img",
      predicates: [{ type: "attrEquals", name: "alt", value: "Stagehand" }],
    };
    expect(
      elementMatchesStep(makeElement("div", { alt: "Stagehand" }), step),
    ).toBe(false);
  });
});

describe("applyPredicates", () => {
  const makeElement = (id: string): Element => {
    return {
      localName: "div",
      getAttribute: (name: string) => (name === "id" ? id : null),
    } as unknown as Element;
  };

  it("applies positional predicates sequentially", () => {
    const elements = ["a", "b", "c", "d"].map(makeElement);
    const predicates: XPathPredicate[] = [
      { type: "index", index: 2 },
      { type: "index", index: 3 },
    ];
    expect(applyPredicates(elements, predicates)).toEqual([]);
  });
});
