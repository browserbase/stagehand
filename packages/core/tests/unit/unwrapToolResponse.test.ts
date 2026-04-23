import { describe, it, expect } from "vitest";
import { unwrapToolResponse } from "../../lib/v3/llm/unwrapToolResponse.js";

describe("unwrapToolResponse", () => {
  it("unwraps $PARAMETER_NAME wrapper", () => {
    const wrapped = {
      $PARAMETER_NAME: {
        elementId: "11-811",
        description: "Create Invoice link button",
        method: "click",
        arguments: [] as never[],
        twoStep: false,
      },
    };
    const result = unwrapToolResponse(wrapped);
    expect(result).toEqual({
      elementId: "11-811",
      description: "Create Invoice link button",
      method: "click",
      arguments: [] as never[],
      twoStep: false,
    });
  });

  it("unwraps any $-prefixed single-key wrapper", () => {
    const wrapped = { $result: { foo: "bar" } };
    expect(unwrapToolResponse(wrapped)).toEqual({ foo: "bar" });
  });

  it("does not unwrap non-$ single-key objects", () => {
    const data = { elementId: "123" };
    expect(unwrapToolResponse(data)).toBe(data);
  });

  it("does not unwrap multi-key objects", () => {
    const data = { $a: 1, $b: 2 };
    expect(unwrapToolResponse(data)).toBe(data);
  });

  it("passes through arrays unchanged", () => {
    const arr = [1, 2, 3];
    expect(unwrapToolResponse(arr)).toBe(arr);
  });

  it("passes through null unchanged", () => {
    expect(unwrapToolResponse(null)).toBe(null);
  });

  it("passes through primitives unchanged", () => {
    expect(unwrapToolResponse("hello")).toBe("hello");
    expect(unwrapToolResponse(42)).toBe(42);
    expect(unwrapToolResponse(true)).toBe(true);
  });

  it("passes through empty objects unchanged", () => {
    const data = {};
    expect(unwrapToolResponse(data)).toBe(data);
  });
});
