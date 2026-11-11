import { describe, expect, it } from "vitest";
import {
  clip,
  isRecord,
  isTokenCount,
  positiveInteger,
  safeJson,
  stringifyError,
  toFiniteNumber,
} from "../src/harness/index.js";

describe("harness value helpers", () => {
  it("isRecord accepts objects and arrays but not null or primitives", () => {
    expect(isRecord({})).toBe(true);
    // Arrays pass, matching every adapter copy this replaced; callers that must reject
    // arrays (facade tools, cursor agent-sdk) keep their own guard.
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("safeJson returns undefined for unserializable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeJson({ a: 1 })).toBe('{"a":1}');
    expect(safeJson(circular)).toBeUndefined();
    expect(safeJson(1n)).toBeUndefined();
  });

  it("stringifyError handles errors, strings, objects, and empty values", () => {
    expect(stringifyError(undefined)).toBe("");
    expect(stringifyError(new Error("boom"))).toBe("boom");
    expect(stringifyError("plain")).toBe("plain");
    expect(stringifyError({ code: 1 })).toBe('{"code":1}');
    expect(stringifyError(1n)).toBe("1");
  });

  it("clip truncates with an ellipsis within the max length", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abcdef", 4)).toHaveLength(4);
  });

  it("toFiniteNumber parses numeric strings and falls back to 0", () => {
    expect(toFiniteNumber(5)).toBe(5);
    expect(toFiniteNumber(" 12 ")).toBe(12);
    expect(toFiniteNumber("")).toBe(0);
    expect(toFiniteNumber("abc")).toBe(0);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toFiniteNumber(null)).toBe(0);
  });

  it("isTokenCount accepts non-negative finite numbers and numeric strings", () => {
    expect(isTokenCount(0)).toBe(true);
    expect(isTokenCount("42")).toBe(true);
    expect(isTokenCount(-1)).toBe(false);
    expect(isTokenCount(" ")).toBe(false);
    expect(isTokenCount(Number.NaN)).toBe(false);
    expect(isTokenCount(undefined)).toBe(false);
  });

  it("positiveInteger floors positive numbers and otherwise uses the fallback", () => {
    expect(positiveInteger(3.7, 10)).toBe(3);
    expect(positiveInteger(0.5, 10)).toBe(1);
    expect(positiveInteger(0, 10)).toBe(10);
    expect(positiveInteger("5", 10)).toBe(10);
  });
});
