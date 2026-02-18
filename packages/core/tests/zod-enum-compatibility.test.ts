import { describe, expect, it } from "vitest";
import * as z3 from "zod/v3";
import { z as z4 } from "zod";
import { SupportedUnderstudyAction } from "../lib/v3/types/private/handlers.js";

/**
 * Tests for Zod v3/v4 compatibility with the SupportedUnderstudyAction enum.
 *
 * This test ensures that z.enum() works correctly with both Zod v3 and v4.
 * The key issue is that z.enum() in Zod v3 does NOT accept TypeScript enums directly -
 * it only accepts string literal tuples. For TypeScript enums, you need to use
 * Object.values() to convert the enum to an array first.
 *
 * In Zod v4, z.enum() was updated to accept TypeScript enums directly, but for
 * backwards compatibility, we should use Object.values() which works with both.
 *
 * See PR #1613: https://github.com/browserbase/stagehand/pull/1613
 */
describe("SupportedUnderstudyAction enum Zod compatibility", () => {
  const testInput = {
    elementId: "1-2",
    method: "click",
    arguments: [] as string[],
  };

  const invalidInput = {
    elementId: "1-2",
    method: "invalidMethod",
    arguments: [] as string[],
  };

  it("Object.values(SupportedUnderstudyAction) produces correct array for z.enum()", () => {
    const enumValues = Object.values(
      SupportedUnderstudyAction,
    ) as unknown as readonly [string, ...string[]];

    expect(enumValues).toContain("click");
    expect(enumValues).toContain("fill");
    expect(enumValues).toContain("type");
    expect(enumValues).toContain("press");
    expect(enumValues).toContain("scrollTo");
    expect(enumValues).toContain("nextChunk");
    expect(enumValues).toContain("prevChunk");
    expect(enumValues).toContain("selectOptionFromDropdown");
    expect(enumValues).toContain("hover");
    expect(enumValues).toContain("doubleClick");
    expect(enumValues).toContain("dragAndDrop");
    expect(enumValues.length).toBe(11);
  });

  it("Zod v3 z.enum() with Object.values(SupportedUnderstudyAction) works correctly", () => {
    const enumValues = Object.values(
      SupportedUnderstudyAction,
    ) as unknown as readonly [string, ...string[]];

    const schema = z3.z.object({
      elementId: z3.z.string(),
      method: z3.z.enum(enumValues),
      arguments: z3.z.array(z3.z.string()),
    });

    // Valid input should pass
    const validResult = schema.safeParse(testInput);
    expect(validResult.success).toBe(true);
    if (validResult.success) {
      expect(validResult.data.method).toBe("click");
    }

    // Invalid input should fail
    const invalidResult = schema.safeParse(invalidInput);
    expect(invalidResult.success).toBe(false);
  });

  it("Zod v4 z.enum() with Object.values(SupportedUnderstudyAction) works correctly", () => {
    const enumValues = Object.values(
      SupportedUnderstudyAction,
    ) as unknown as readonly [string, ...string[]];

    const schema = z4.object({
      elementId: z4.string(),
      method: z4.enum(enumValues),
      arguments: z4.array(z4.string()),
    });

    // Valid input should pass
    const validResult = schema.safeParse(testInput);
    expect(validResult.success).toBe(true);
    if (validResult.success) {
      expect(validResult.data.method).toBe("click");
    }

    // Invalid input should fail
    const invalidResult = schema.safeParse(invalidInput);
    expect(invalidResult.success).toBe(false);
  });

  it("Zod v3 z.enum() with raw TypeScript enum throws error on parse", () => {
    // This demonstrates the bug that PR #1613 would introduce
    // In Zod v3, z.enum() does NOT accept TypeScript enums directly
    // The schema creation might succeed, but parsing will fail

    const schema = z3.z.object({
      elementId: z3.z.string(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method: z3.z.enum(SupportedUnderstudyAction as any),
      arguments: z3.z.array(z3.z.string()),
    });

    // This should throw an error because the enum is not iterable
    expect(() => schema.safeParse(testInput)).toThrow("object is not iterable");
  });

  it("Zod v4 z.enum() with raw TypeScript enum works (but not v3 compatible)", () => {
    // Zod v4 allows passing TypeScript enums directly to z.enum()
    // But this approach is NOT backwards compatible with v3

    const schema = z4.object({
      elementId: z4.string(),
      method: z4.enum(SupportedUnderstudyAction),
      arguments: z4.array(z4.string()),
    });

    // In v4, this works fine
    const validResult = schema.safeParse(testInput);
    expect(validResult.success).toBe(true);
  });

  it("All SupportedUnderstudyAction values are valid enum options", () => {
    const enumValues = Object.values(
      SupportedUnderstudyAction,
    ) as unknown as readonly [string, ...string[]];

    // Test with both v3 and v4 schemas
    const v3Schema = z3.z.enum(enumValues);
    const v4Schema = z4.enum(enumValues);

    for (const action of enumValues) {
      expect(v3Schema.safeParse(action).success).toBe(true);
      expect(v4Schema.safeParse(action).success).toBe(true);
    }
  });
});
