import { describe, expect, it } from "vitest";
import { normalizeUrlForCacheKey } from "../../lib/v3/cache/utils.js";

describe("normalizeUrlForCacheKey", () => {
  it("returns the input unchanged when there are no query parameters", () => {
    const input = "https://example.com/products";
    expect(normalizeUrlForCacheKey(input)).toBe(input);
  });

  it("sorts query parameters alphabetically", () => {
    expect(normalizeUrlForCacheKey("https://example.com/?b=2&a=1&c=3")).toBe(
      "https://example.com/?a=1&b=2&c=3",
    );
  });

  it("produces identical output for URLs that differ only in parameter order", () => {
    const a = normalizeUrlForCacheKey(
      "https://shop.example.com/cart?utm_source=email&id=42",
    );
    const b = normalizeUrlForCacheKey(
      "https://shop.example.com/cart?id=42&utm_source=email",
    );
    expect(a).toBe(b);
  });

  it("preserves duplicate keys in their original order", () => {
    // `?a=1&a=2` and `?a=2&a=1` are semantically distinct (different value
    // lists), so duplicates must keep their relative order even after sort.
    expect(normalizeUrlForCacheKey("https://example.com/?a=1&a=2")).toBe(
      "https://example.com/?a=1&a=2",
    );
    expect(normalizeUrlForCacheKey("https://example.com/?a=2&a=1")).toBe(
      "https://example.com/?a=2&a=1",
    );
  });

  it("preserves the URL fragment", () => {
    // Fragments often indicate distinct views in SPAs, so we deliberately
    // do not strip them.
    expect(
      normalizeUrlForCacheKey("https://docs.example.com/guide#install"),
    ).toBe("https://docs.example.com/guide#install");
  });

  it("preserves path and origin", () => {
    expect(
      normalizeUrlForCacheKey("https://sub.example.com:8443/a/b/c?z=1&a=2"),
    ).toBe("https://sub.example.com:8443/a/b/c?a=2&z=1");
  });

  it("returns the input unchanged for an empty string", () => {
    expect(normalizeUrlForCacheKey("")).toBe("");
  });

  it("returns the input unchanged for an unparseable URL", () => {
    expect(normalizeUrlForCacheKey("not a url")).toBe("not a url");
  });

  it("returns the input unchanged for browser-internal URLs", () => {
    expect(normalizeUrlForCacheKey("about:blank")).toBe("about:blank");
  });
});
