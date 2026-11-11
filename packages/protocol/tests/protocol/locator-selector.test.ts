import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { LocatorSchema, LocatorQuerySelectorSchema } from "../../schemas.js";
import type { LocatorQuerySelector } from "../../types.js";

describe("structured locator selectors", () => {
  it.each<LocatorQuerySelector>([
    { type: "css", value: "button.submit" },
    { type: "xpath", value: "//button[@type='submit']" },
    { type: "text", value: "Submit" },
  ])("accepts $type selectors", (selector) => {
    expect(LocatorQuerySelectorSchema.parse(selector)).toEqual(selector);
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
    expect(LocatorQuerySelectorSchema.safeParse(selector).success).toBe(false);
  });

  it("preserves explicit text values", () => {
    expect(LocatorQuerySelectorSchema.parse({ type: "text", value: ' "Submit" ' })).toEqual({
      type: "text",
      value: ' "Submit" ',
    });
  });

  it("can generate JSON Schema with named variants", () => {
    const schema = z.toJSONSchema(LocatorQuerySelectorSchema, { io: "input" });
    expect(schema.$defs).toHaveProperty("CssLocatorSelector");
    expect(schema.$defs).toHaveProperty("XPathLocatorSelector");
    expect(schema.$defs).toHaveProperty("TextLocatorSelector");
    expect(schema.$defs).not.toHaveProperty("LegacyLocatorSelector");
  });

  it("requires structured selectors in wire locators", () => {
    const locator = {
      selector: { steps: [{ type: "query", selector: { type: "css", value: "button" }, nth: 0 }] },
    };
    expect(LocatorSchema.parse(locator)).toEqual(locator);
    expect(LocatorSchema.safeParse({ selector: "button" }).success).toBe(false);
    expect(LocatorSchema.safeParse({ selector: { type: "legacy", value: "button" } }).success).toBe(
      false,
    );
    expect(LocatorSchema.safeParse({ ...locator, nth: 0 }).success).toBe(false);
    expect(z.toJSONSchema(LocatorSchema, { io: "input" }).$defs).not.toHaveProperty(
      "LegacyLocatorSelector",
    );
  });
});
