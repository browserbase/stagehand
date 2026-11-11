import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/locator-normalization.json" with { type: "json" };
import { LocatorSelectorSchema, normalizeLocatorSelector } from "../src/locatorSelector.js";

describe("SDK locator normalization", () => {
  it.each(cases)("normalizes $input into engine and frame steps", ({ input, chain }) => {
    const selector = typeof input === "string" ? input : LocatorSelectorSchema.parse(input);
    expect(normalizeLocatorSelector(selector)).toEqual(chain);
    if (typeof input === "string") {
      expect(normalizeLocatorSelector({ type: "legacy", value: input })).toEqual(chain);
    }
  });
  it("copies explicit inputs without changing their values", () => {
    const selector = Object.freeze({ type: "text" as const, value: 'text="Pay" >> now' });
    const chain = normalizeLocatorSelector(selector);
    expect(chain).toEqual({ steps: [{ type: "query", selector }] });
    expect(chain.steps[0]!.selector).not.toBe(selector);
  });
  it("validates untyped inputs at construction", () => {
    expect(() => normalizeLocatorSelector("")).toThrow();
    // @ts-expect-error Exercise validation for JavaScript callers.
    expect(() => normalizeLocatorSelector({ type: "text", value: 123 })).toThrow();
  });
});
