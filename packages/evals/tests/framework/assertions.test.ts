import { describe, it, expect } from "vitest";
import {
  createAssertHelpers,
  AssertionError,
} from "../../framework/assertions.js";

describe("AssertionError", () => {
  it("has correct name and properties", () => {
    const err = new AssertionError("boom", "actual", "expected");
    expect(err.name).toBe("AssertionError");
    expect(err.message).toBe("boom");
    expect(err.actual).toBe("actual");
    expect(err.expected).toBe("expected");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("createAssertHelpers", () => {
  const assert = createAssertHelpers();

  describe("equals", () => {
    it("passes on matching primitives", () => {
      assert.equals(1, 1);
      assert.equals("a", "a");
      assert.equals(true, true);
      assert.equals(null, null);
    });

    it("passes on deep-equal objects", () => {
      assert.equals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
    });

    it("throws on mismatch", () => {
      expect(() => assert.equals(1, 2)).toThrow(AssertionError);
      expect(() => assert.equals({ a: 1 }, { a: 2 })).toThrow(AssertionError);
    });

    it("includes custom message", () => {
      expect(() => assert.equals(1, 2, "custom")).toThrow("custom");
    });
  });

  describe("matches", () => {
    it("passes when regex matches", () => {
      assert.matches("hello world", /hello/);
      assert.matches("abc123", /\d+/);
    });

    it("throws when regex does not match", () => {
      expect(() => assert.matches("hello", /xyz/)).toThrow(AssertionError);
    });
  });

  describe("includes", () => {
    it("passes on substring found", () => {
      assert.includes("hello world", "world");
    });

    it("throws on missing substring", () => {
      expect(() => assert.includes("hello", "xyz")).toThrow(AssertionError);
    });
  });

  describe("truthy", () => {
    it("passes on truthy values", () => {
      assert.truthy(1);
      assert.truthy("a");
      assert.truthy({});
      assert.truthy([]);
      assert.truthy(true);
    });

    it("throws on falsy values", () => {
      expect(() => assert.truthy(0)).toThrow(AssertionError);
      expect(() => assert.truthy("")).toThrow(AssertionError);
      expect(() => assert.truthy(null)).toThrow(AssertionError);
      expect(() => assert.truthy(undefined)).toThrow(AssertionError);
      expect(() => assert.truthy(false)).toThrow(AssertionError);
    });
  });

  describe("falsy", () => {
    it("passes on falsy values", () => {
      assert.falsy(0);
      assert.falsy("");
      assert.falsy(null);
      assert.falsy(undefined);
      assert.falsy(false);
    });

    it("throws on truthy values", () => {
      expect(() => assert.falsy(1)).toThrow(AssertionError);
      expect(() => assert.falsy("a")).toThrow(AssertionError);
    });
  });

  describe("lessThan", () => {
    it("passes when actual < expected", () => {
      assert.lessThan(3, 5);
    });

    it("throws when actual >= expected", () => {
      expect(() => assert.lessThan(5, 3)).toThrow(AssertionError);
      expect(() => assert.lessThan(5, 5)).toThrow(AssertionError);
    });
  });

  describe("greaterThan", () => {
    it("passes when actual > expected", () => {
      assert.greaterThan(5, 3);
    });

    it("throws when actual <= expected", () => {
      expect(() => assert.greaterThan(3, 5)).toThrow(AssertionError);
      expect(() => assert.greaterThan(5, 5)).toThrow(AssertionError);
    });
  });
});
