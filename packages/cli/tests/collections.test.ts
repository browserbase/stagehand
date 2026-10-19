import { describe, expect, it } from "vitest";
import { collect, type CollectionSource } from "../src/lib/collections.js";

describe("cursor collection boundaries", () => {
  it("accepts advancing empty pages and stops exactly at the requested record", async () => {
    const calls: Array<{ limit: number; cursor?: string }> = [];
    const source: CollectionSource<number> = {
      kind: "cursor",
      pageSize: 2,
      loadPage: async (options) => {
        calls.push(options);
        if (!options.cursor) return { data: [], nextCursor: "a+b/==" };
        if (options.cursor === "a+b/==")
          return { data: [1, 2], nextCursor: "after-2" };
        return { data: [3], nextCursor: "after-3" };
      },
    };
    expect(await collect(source, { limit: 3 })).toEqual({
      data: [1, 2, 3],
      hasMore: true,
      nextCursor: "after-3",
    });
    expect(calls).toEqual([
      { limit: 2, cursor: undefined },
      { limit: 2, cursor: "a+b/==" },
      { limit: 1, cursor: "after-2" },
    ]);
  });

  it.each(["", "initial"])(
    "rejects invalid continuation %j",
    async (nextCursor) => {
      await expect(
        collect(
          {
            kind: "cursor",
            pageSize: 1000,
            loadPage: async () => ({ data: [], nextCursor }),
          },
          { cursor: "initial" },
        ),
      ).rejects.toThrow("pagination cursor");
    },
  );

  it("allows total limits greater than the API page size", async () => {
    const calls: number[] = [];
    const result = await collect(
      {
        kind: "cursor",
        pageSize: 1000,
        loadPage: async ({ limit, cursor }) => {
          calls.push(limit);
          return {
            data: Array.from(
              { length: limit },
              (_, i) => Number(cursor ?? 0) + i,
            ),
            nextCursor: cursor ? null : "1000",
          };
        },
      },
      { limit: 1001 },
    );
    expect(result.data).toHaveLength(1001);
    expect(result.data[1000]).toBe(1000);
    expect(result.hasMore).toBe(false);
    expect(calls).toEqual([1000, 1]);
  });
});
