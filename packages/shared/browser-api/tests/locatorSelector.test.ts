import { describe, expect, it } from "vitest";
import { normalizeLocatorSelector } from "../src/locatorSelector.js";
import type { LocatorSelector } from "@browserbasehq/stagehand-protocol/types";

describe("normalizeLocatorSelector", () => {
  it.each([
    "button.submit",
    " css=button.submit ",
    "CSS=button",
    "//button",
    "(//button)[2]",
    "xpath=//button",
    "XPATH=//button",
    "xpath=/html/body/iframe[1]/html/body/button",
    "iframe#outer >> iframe#inner >> text=Submit",
    'text="Submit"',
    "text='Submit'",
    "TEXT=  Submit  ",
    'text="a >> b"',
    "text=",
    "css=",
    "xpath=",
    "   ",
  ])("preserves legacy expression %j exactly", (value) => {
    expect(normalizeLocatorSelector(value)).toEqual({ type: "legacy", value });
  });

  it.each<LocatorSelector>([
    { type: "css", value: 'button[data-label="a >> b"]' },
    { type: "xpath", value: '//button[@title="text=Submit"]' },
    { type: "text", value: ' "Submit" ' },
    { type: "text", value: "text=Submit" },
    { type: "legacy", value: "iframe >> text=Submit" },
  ])("preserves explicit $type values", (selector) => {
    const input = Object.freeze({ ...selector });
    expect(normalizeLocatorSelector(input)).toEqual(selector);
    expect(input).toEqual(selector);
  });

  it("is idempotent", () => {
    const selector = normalizeLocatorSelector("iframe >> text=Submit");
    expect(normalizeLocatorSelector(selector)).toEqual(selector);
  });

  it("rejects empty legacy strings, as the existing protocol does", () => {
    expect(() => normalizeLocatorSelector("")).toThrow();
  });

  it("validates inputs from untyped callers", () => {
    // @ts-expect-error Exercise runtime validation for JavaScript callers.
    expect(() => normalizeLocatorSelector({ type: "text", value: 123 })).toThrow();
  });
});
