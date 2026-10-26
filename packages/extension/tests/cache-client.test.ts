import { describe, expect, it, vi } from "vitest";
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
  const maxBodyBytes = 25_000_000;
  const baseRequest = {
    method: "extract" as const,
    sessionId: "session-1",
    url: "https://example.com",
    cdpTree: { rootFrameId: "frame-1", frames: [] },
    data: {},
  };

  it.each([
    ["get", -1],
    ["get", 0],
    ["get", 1],
    ["set", -1],
    ["set", 0],
    ["set", 1],
  ] as const)(
    "checks the %s body at a %s-byte offset from the limit",
    async (operation, offset) => {
      const success =
        operation === "get" ? { cacheKey: "key", hit: false } : { cacheKey: "key", written: true };
      const send = vi.fn(
        async () => new Response(JSON.stringify({ success: true, data: success })),
      );
      const client = new CacheClient({ request: send });
      const getRequest = { ...baseRequest, data: { padding: "" } };
      const setRequest = { ...getRequest, value: { answer: 42 } };
      const input = operation === "get" ? getRequest : setRequest;
      input.data.padding = "x".repeat(
        maxBodyBytes + offset - Buffer.byteLength(JSON.stringify(input)),
      );
      expect(Buffer.byteLength(JSON.stringify(input))).toBe(maxBodyBytes + offset);
      const result =
        operation === "get" ? await client.get(getRequest) : await client.set(setRequest);
      expect(result).toEqual(
        offset > 0
          ? {
              cacheKey: null,
              ...(operation === "get"
                ? { hit: false, missReason: "payload_too_large" }
                : { written: false, skippedReason: "payload_too_large" }),
            }
          : success,
      );
      expect(send).toHaveBeenCalledTimes(offset > 0 ? 0 : 1);
    },
  );

  it.each(
    ["é", "界", "😀"].flatMap((character) => [0, 1].map((offset) => ({ character, offset }))),
  )(
    "counts UTF-8 bytes for $character at a $offset-byte offset from the limit",
    async ({ character, offset }) => {
      const miss = { cacheKey: "key", hit: false };
      const send = vi.fn(async () => new Response(JSON.stringify({ success: true, data: miss })));
      const client = new CacheClient({ request: send });
      const input = { ...baseRequest, data: { padding: "" } };
      const paddingBytes = maxBodyBytes + offset - Buffer.byteLength(JSON.stringify(input));
      const width = Buffer.byteLength(character);
      input.data.padding =
        character.repeat(Math.floor(paddingBytes / width)) + "x".repeat(paddingBytes % width);
      const body = JSON.stringify(input);
      expect(body.length).toBeLessThan(maxBodyBytes);
      expect(Buffer.byteLength(body)).toBe(maxBodyBytes + offset);
      await expect(client.get(input)).resolves.toEqual(
        offset > 0 ? { cacheKey: null, hit: false, missReason: "payload_too_large" } : miss,
      );
      expect(send).toHaveBeenCalledTimes(offset > 0 ? 0 : 1);
    },
  );

  it("surfaces an unexpected payload instead of returning a half-parsed response", async () => {
    const client = new CacheClient({
      request: async () =>
        new Response(JSON.stringify({ success: true, data: { cacheKey: "key", hit: "yes" } }), {
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      client.get({
        method: "extract",
        sessionId: "session-1",
        url: "https://example.com",
        cdpTree: { rootFrameId: "frame-1", frames: [] },
        data: {},
      }),
    ).rejects.toThrow(/unexpected payload/);
  });
});
