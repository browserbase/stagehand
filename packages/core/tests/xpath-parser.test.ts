import { describe, expect, it } from "vitest";
import {
  parseXPathSteps,
  elementMatchesStep,
  type XPathStep,
} from "../lib/v3/dom/locatorScripts/xpathParser";

describe("parseXPathSteps", () => {
  describe("basic tag parsing", () => {
    it("parses a simple absolute path", () => {
      expect(parseXPathSteps("/html/body/div")).toEqual([
        { axis: "child", tag: "html", index: null, attrs: [] },
        { axis: "child", tag: "body", index: null, attrs: [] },
        { axis: "child", tag: "div", index: null, attrs: [] },
      ]);
    });

    it("lowercases tag names", () => {
      const steps = parseXPathSteps("/HTML/BODY");
      expect(steps[0].tag).toBe("html");
      expect(steps[1].tag).toBe("body");
    });

    it("treats wildcard correctly", () => {
      const steps = parseXPathSteps("//*");
      expect(steps).toEqual([
        { axis: "desc", tag: "*", index: null, attrs: [] },
      ]);
    });
  });

  describe("axes", () => {
    it("distinguishes child (/) from descendant (//)", () => {
      const steps = parseXPathSteps("/html//div/span");
      expect(steps).toEqual([
        { axis: "child", tag: "html", index: null, attrs: [] },
        { axis: "desc", tag: "div", index: null, attrs: [] },
        { axis: "child", tag: "span", index: null, attrs: [] },
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
      expect(steps[0]).toMatchObject({ tag: "div", index: 1 });
      expect(steps[1]).toMatchObject({ tag: "span", index: 3 });
    });

    it("clamps index to minimum 1", () => {
      const steps = parseXPathSteps("/div[0]");
      expect(steps[0].index).toBe(1);
    });
  });

  describe("attribute predicates", () => {
    it("parses single attribute predicate with single quotes", () => {
      const steps = parseXPathSteps("//img[@alt='Stagehand']");
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "img",
          index: null,
          attrs: [{ name: "alt", value: "Stagehand" }],
        },
      ]);
    });

    it("parses single attribute predicate with double quotes", () => {
      const steps = parseXPathSteps('//img[@alt="Stagehand"]');
      expect(steps[0].attrs).toEqual([{ name: "alt", value: "Stagehand" }]);
    });

    it("parses multiple attribute predicates", () => {
      const steps = parseXPathSteps("//div[@class='foo'][@id='bar']");
      expect(steps[0].attrs).toEqual([
        { name: "class", value: "foo" },
        { name: "id", value: "bar" },
      ]);
    });

    it("parses attribute predicate combined with positional index", () => {
      const steps = parseXPathSteps("//div[@class='item'][2]");
      expect(steps[0]).toMatchObject({
        tag: "div",
        index: 2,
        attrs: [{ name: "class", value: "item" }],
      });
    });

    it("parses attribute with hyphenated name", () => {
      const steps = parseXPathSteps("//div[@data-testid='submit']");
      expect(steps[0].attrs).toEqual([
        { name: "data-testid", value: "submit" },
      ]);
    });

    it("parses attribute with empty value", () => {
      const steps = parseXPathSteps("//input[@value='']");
      expect(steps[0].attrs).toEqual([{ name: "value", value: "" }]);
    });

    it("parses attribute value containing closing bracket", () => {
      const steps = parseXPathSteps("//div[@title='array[0]']");
      expect(steps[0].attrs).toEqual([{ name: "title", value: "array[0]" }]);
    });

    it("parses attribute value containing multiple brackets", () => {
      const steps = parseXPathSteps("//div[@data-json='[1,2,3]']");
      expect(steps[0].attrs).toEqual([{ name: "data-json", value: "[1,2,3]" }]);
    });
  });

  describe("multi-step with predicates", () => {
    it("parses complex path with mixed predicates", () => {
      const steps = parseXPathSteps(
        "/html/body//div[@class='container']/ul/li[3]",
      );
      expect(steps).toEqual([
        { axis: "child", tag: "html", index: null, attrs: [] },
        { axis: "child", tag: "body", index: null, attrs: [] },
        {
          axis: "desc",
          tag: "div",
          index: null,
          attrs: [{ name: "class", value: "container" }],
        },
        { axis: "child", tag: "ul", index: null, attrs: [] },
        { axis: "child", tag: "li", index: 3, attrs: [] },
      ]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(parseXPathSteps("")).toEqual([]);
    });

    it("strips xpath= prefix", () => {
      const steps = parseXPathSteps("xpath=//div");
      expect(steps).toEqual([
        { axis: "desc", tag: "div", index: null, attrs: [] },
      ]);
    });

    it("strips XPATH= prefix (case-insensitive)", () => {
      const steps = parseXPathSteps("XPATH=//div");
      expect(steps).toEqual([
        { axis: "desc", tag: "div", index: null, attrs: [] },
      ]);
    });

    it("handles forward slashes inside attribute values", () => {
      const steps = parseXPathSteps("//a[@href='/api/endpoint']");
      expect(steps).toEqual([
        {
          axis: "desc",
          tag: "a",
          index: null,
          attrs: [{ name: "href", value: "/api/endpoint" }],
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
          index: null,
          attrs: [
            { name: "data-url", value: "http://example.com/path/to/page" },
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
  ): Element => {
    return {
      localName,
      getAttribute: (name: string) => attributes[name] ?? null,
    } as unknown as Element;
  };

  it("matches by tag name", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      index: null,
      attrs: [],
    };
    expect(elementMatchesStep(makeElement("div"), step)).toBe(true);
    expect(elementMatchesStep(makeElement("span"), step)).toBe(false);
  });

  it("wildcard matches any element", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "*",
      index: null,
      attrs: [],
    };
    expect(elementMatchesStep(makeElement("div"), step)).toBe(true);
    expect(elementMatchesStep(makeElement("span"), step)).toBe(true);
  });

  it("matches attribute predicates", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "img",
      index: null,
      attrs: [{ name: "alt", value: "Stagehand" }],
    };
    expect(
      elementMatchesStep(makeElement("img", { alt: "Stagehand" }), step),
    ).toBe(true);
    expect(elementMatchesStep(makeElement("img", { alt: "Other" }), step)).toBe(
      false,
    );
    expect(elementMatchesStep(makeElement("img"), step)).toBe(false);
  });

  it("requires all attribute predicates to match", () => {
    const step: XPathStep = {
      axis: "desc",
      tag: "div",
      index: null,
      attrs: [
        { name: "class", value: "foo" },
        { name: "id", value: "bar" },
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
      index: null,
      attrs: [{ name: "alt", value: "Stagehand" }],
    };
    expect(
      elementMatchesStep(makeElement("div", { alt: "Stagehand" }), step),
    ).toBe(false);
  });
});
