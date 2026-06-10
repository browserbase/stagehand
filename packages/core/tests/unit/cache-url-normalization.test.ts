import { describe, expect, it } from "vitest";
import { normalizeUrlForCacheKey } from "../../lib/v3/cache/utils.js";

describe("normalizeUrlForCacheKey", () => {
  it("sorts query parameters without changing the rest of the URL", () => {
    expect(
      normalizeUrlForCacheKey("https://example.com/search?b=2&a=1#items"),
    ).toBe("https://example.com/search?a=1&b=2#items");
  });

  it("keeps repeated parameter order stable within the same key", () => {
    expect(
      normalizeUrlForCacheKey("https://example.com/search?tag=b&a=1&tag=a"),
    ).toBe("https://example.com/search?a=1&tag=b&tag=a");
  });

  it("returns non-URL inputs unchanged", () => {
    expect(normalizeUrlForCacheKey("about:blank")).toBe("about:blank");
    expect(normalizeUrlForCacheKey("not a url")).toBe("not a url");
  });

  it("leaves URLs unchanged when query parameters are already stable", () => {
    expect(normalizeUrlForCacheKey("https://example.com/search?a=1&b=2")).toBe(
      "https://example.com/search?a=1&b=2",
    );
  });
});
