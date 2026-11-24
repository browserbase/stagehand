import { describe, expect, it } from "vitest";
import { createTextMatcher, normalizeQueryText } from "../dom/locatorScripts/textQuery.js";

describe("normalized text matcher", () => {
  it.each([
    ["  Save\n\t now\u00a0", "Save now"],
    ["\u2003東京\u202f café  ", "東京 café"],
    [" \r\n ", ""],
    ["a\u200bb", "a\u200bb"],
  ])("normalizes %j", (text, expected) => {
    expect(normalizeQueryText(text)).toBe(expected);
  });

  it.each([
    ["save", " Save\nNOW ", false, true],
    ["Save now", " Save\nNOW ", true, false],
    [" Save  now ", "Save\nnow", true, true],
    ["Save", "Save now", true, false],
    ["CAFÉ", "café 東京", false, true],
    ["東京", "東京", true, true],
    ["", "anything", false, true],
    [" \t", "anything", true, false],
    ["", " \n", true, true],
  ])("matches %j against %j (exact: %s)", (needle, candidate, exact, expected) => {
    expect(createTextMatcher(needle, exact)(candidate)).toBe(expected);
  });

  it.each([/Save/, { text: "Save" }, null, 42])("rejects unsupported matcher %j", (matcher) => {
    expect(() => createTextMatcher(matcher as never)).toThrow("string matcher");
  });
});
