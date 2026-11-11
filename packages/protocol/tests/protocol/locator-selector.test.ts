import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { LocatorSchema, LocatorSelectorSchema } from "../../schemas.js";
import type { LocatorSelector } from "../../types.js";

describe("structured locator selectors", () => {
  it.each<LocatorSelector>([
    { type: "css", value: "button.submit" },
    { type: "xpath", value: "//button[@type='submit']" },
    { type: "text", value: "Submit" },
    { type: "legacy", value: "iframe >> text=Submit" },
  ])("accepts $type selectors", (selector) => {
    expect(LocatorSelectorSchema.parse(selector)).toEqual(selector);
  });

  it.each([
    "button",
    {},
    { value: "Submit" },
    { type: "role", value: "button" },
    { type: "css", value: 123 },
    { type: "css", value: "" },
    { type: "xpath", value: "" },
    { type: "text", value: "" },
    { type: "legacy", value: "" },
    { type: "text", value: "Submit", css: "button" },
  ])("rejects invalid selectors: %j", (selector) => {
    expect(LocatorSelectorSchema.safeParse(selector).success).toBe(false);
  });

  it("preserves explicit text values", () => {
    expect(LocatorSelectorSchema.parse({ type: "text", value: ' "Submit" ' })).toEqual({
      type: "text",
      value: ' "Submit" ',
    });
  });

  it("can generate JSON Schema with named variants", () => {
    const schema = z.toJSONSchema(LocatorSelectorSchema, { io: "input" });
    expect(schema.$defs).toHaveProperty("CssLocatorSelector");
    expect(schema.$defs).toHaveProperty("XPathLocatorSelector");
    expect(schema.$defs).toHaveProperty("TextLocatorSelector");
    expect(schema.$defs).toHaveProperty("LegacyLocatorSelector");
  });

  it("leaves the current wire locator contract unchanged", () => {
    expect(LocatorSchema.parse({ selector: "button", nth: 0 })).toEqual({
      selector: "button",
      nth: 0,
    });
    expect(LocatorSchema.safeParse({ selector: { type: "css", value: "button" } }).success).toBe(
      false,
    );
  });
});
