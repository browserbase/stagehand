import { describe, it, expect } from "vitest";
import { unwrapToolResponse } from "../../lib/v3/llm/unwrapToolResponse";

describe("unwrapToolResponse", () => {
  it("unwraps $PARAMETER_NAME wrapper", () => {
    const wrapped = {
      $PARAMETER_NAME: {
        elementId: "11-811",
        description: "Create Invoice link button",
        method: "click",
        arguments: [],
        twoStep: false,
      },
    };
    const result = unwrapToolResponse(wrapped);
    expect(result).toEqual({
      elementId: "11-811",
      description: "Create Invoice link button",
      method: "click",
      arguments: [],
      twoStep: false,
    });
  });

  it("unwraps any $-prefixed single-key wrapper", () => {
    const wrapped = { $value: { name: "test", count: 42 } };
    const result = unwrapToolResponse(wrapped);
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("does not unwrap objects with multiple keys", () => {
    const obj = { a: 1, b: 2 };
    const result = unwrapToolResponse(obj as any);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("does not unwrap when inner value is not an object", () => {
    const obj = { $key: "string value" };
    const result = unwrapToolResponse(obj as any);
    expect(result).toEqual({ $key: "string value" });
  });

  it("does not unwrap when inner value is an array", () => {
    const obj = { $key: [1, 2, 3] };
    const result = unwrapToolResponse(obj as any);
    expect(result).toEqual({ $key: [1, 2, 3] });
  });

  it("returns null/undefined/arrays unchanged", () => {
    expect(unwrapToolResponse(null as any)).toBeNull();
    expect(unwrapToolResponse(undefined as any)).toBeUndefined();
    expect(unwrapToolResponse([] as any)).toEqual([]);
  });

  it("does not unwrap single-key objects that don't start with $", () => {
    const obj = { elementId: "11-811" };
    const result = unwrapToolResponse(obj as any);
    expect(result).toEqual({ elementId: "11-811" });
  });

  it("unwraps non-$ key when expectedKeys hint is provided", () => {
    const wrapped = {
      json: {
        elementId: "11-811",
        method: "click",
      },
    };
    const result = unwrapToolResponse(wrapped as any, ["elementId", "method"]);
    expect(result).toEqual({ elementId: "11-811", method: "click" });
  });

  it("does not unwrap when single key matches expected keys", () => {
    const obj = { elementId: "11-811" };
    const result = unwrapToolResponse(obj as any, ["elementId", "method"]);
    expect(result).toEqual({ elementId: "11-811" });
  });
});
