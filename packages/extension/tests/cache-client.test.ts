import { describe, expect, it } from "vitest";
import { CacheClient, CacheGetResponseSchema } from "../clients/cacheClient.js";

/**
 * The cache client is the only place the API's wire shape is validated, and
 * cache-service tests mock past it — so a renamed or malformed field would
 * otherwise only surface in production.
 */
describe("CacheGetResponseSchema", () => {
  it("parses a hit carrying token savings in the API's shape", () => {
    const parsed = CacheGetResponseSchema.parse({
      cacheKey: "key",
      hit: true,
      value: { answer: 42 },
      hitCount: 3,
      threshold: 1,
      ageMs: 120,
      tokensSaved: { input: 8000, output: 120, total: 8120 },
    });

    expect(parsed.tokensSaved).toStrictEqual({ input: 8000, output: 120, total: 8120 });
  });

  it("parses a hit with no savings recorded", () => {
    const parsed = CacheGetResponseSchema.parse({ cacheKey: "key", hit: true, value: 1 });
    expect(parsed.tokensSaved).toBeUndefined();
  });

  it("rejects malformed savings rather than passing them through", () => {
    for (const tokensSaved of [
      { input: "8000", output: 120, total: 8120 },
      { input: 8000, output: 120 },
      null,
    ]) {
      expect(
        CacheGetResponseSchema.safeParse({ cacheKey: "key", hit: true, tokensSaved }).success,
      ).toBe(false);
    }
  });

  it("parses a miss with its reason", () => {
    const parsed = CacheGetResponseSchema.parse({
      cacheKey: "key",
      hit: false,
      missReason: "threshold",
      threshold: 3,
      hitCount: 2,
    });

    expect(parsed).toMatchObject({ hit: false, missReason: "threshold", hitCount: 2 });
  });
});

describe("CacheClient", () => {
  it("surfaces an unexpected payload instead of returning a half-parsed response", async () => {
    const client = new CacheClient("http://cache.test/v1", "bb-key");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, data: { cacheKey: "key", hit: "yes" } }), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      await expect(
        client.get({
          method: "extract",
          sessionId: "session-1",
          url: "https://example.com",
          cdpTree: { rootFrameId: "frame-1", frames: [] },
          data: {},
        }),
      ).rejects.toThrow(/unexpected payload/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
