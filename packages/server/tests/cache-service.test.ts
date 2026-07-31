import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import type { CacheMetadata } from "../../protocol/types.js";
import type { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import type { Frame } from "../understudy/frame.js";

describe("cache service", () => {
  it("marks a cache hit without executing the live request", async () => {
    const get = vi.fn().mockResolvedValue({ hit: true, value: { answer: 42 }, cacheKey: "key" });
    const execute = executesTo({ answer: 0 });

    const result = await runWithCache({ get, execute });

    // No detail from the server, so no cacheMetadata: cacheStatus already
    // says a lookup ran.
    expect(result).toStrictEqual({
      data: { answer: 42 },
      metadata: { cacheStatus: "HIT" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports hit count, age, threshold, and token savings on a hit", async () => {
    const get = vi.fn().mockResolvedValue({
      hit: true,
      value: { answer: 42 },
      cacheKey: "key",
      hitCount: 3,
      threshold: 2,
      ageMs: 1500,
      tokensSaved: { input: 8000, output: 120, total: 8120 },
    });

    const result = await runWithCache({ get, execute: executesTo({ answer: 0 }) });

    expect(result.metadata).toStrictEqual({
      cacheStatus: "HIT",
      cacheMetadata: {
        count: 3,
        threshold: 2,
        ageMs: 1500,
        tokensSaved: { inputTokens: 8000, outputTokens: 120, totalTokens: 8120 },
      },
    });
  });

  it("marks a miss and persists the cache value", async () => {
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
    const result = await runWithCache({
      get: vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" }),
      set,
      execute: executesTo({ answer: 42 }),
    });

    expect(result).toStrictEqual({
      data: { answer: 42 },
      metadata: { cacheStatus: "MISS", cacheMetadata: { missReason: "not_found" } },
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: { answer: 42 } }));
  });

  // A threshold miss is the one miss that carries progress information: the
  // caller can see how many more identical requests are needed.
  it("reports progress toward the threshold on a threshold miss", async () => {
    const result = await runWithCache({
      get: vi.fn().mockResolvedValue({
        hit: false,
        cacheKey: "key",
        missReason: "threshold",
        threshold: 3,
        hitCount: 2,
      }),
      execute: executesTo({ answer: 42 }),
    });

    expect(result.metadata.cacheMetadata).toStrictEqual({
      missReason: "threshold",
      count: 2,
      threshold: 3,
    });
  });

  it("distinguishes a failed cache read from a cold cache", async () => {
    const result = await runWithCache({
      get: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
      execute: executesTo({ answer: 42 }),
    });

    expect(result.metadata).toStrictEqual({
      cacheStatus: "MISS",
      cacheMetadata: { missReason: "read_failed" },
    });
  });

  it("distinguishes an unusable cached value from a cold cache", async () => {
    const execute = executesTo({ answer: 42 });
    const result = await cacheService.withCache({
      ...baseArgs(),
      context: cacheContext(
        vi
          .fn()
          .mockResolvedValue({ hit: true, value: { answer: 1 }, cacheKey: "key", hitCount: 4 }),
        vi.fn().mockResolvedValue({ written: true, cacheKey: "key" }),
      ),
      onHit: (): TestResult => {
        throw new Error("cached actions no longer match the page");
      },
      execute,
    });

    expect(result.metadata).toStrictEqual({
      cacheStatus: "MISS",
      cacheMetadata: { missReason: "replay_failed", count: 4 },
    });
    expect(execute).toHaveBeenCalled();
  });

  it("leaves metadata untouched when no cache lookup runs", async () => {
    const result = await cacheService.withCache({
      ...baseArgs(),
      caching: false,
      context: cacheContext(vi.fn(), vi.fn()),
      onHit: (value) => ({ data: value, metadata: {} }),
      execute: executesTo({ answer: 42 }),
    });

    expect(result.metadata).toStrictEqual({});
  });
});

interface TestResult {
  data: unknown;
  metadata: { cacheStatus?: "HIT" | "MISS"; cacheMetadata?: CacheMetadata };
}

function baseArgs() {
  return {
    method: "extract" as const,
    page: cachePage(),
    data: { instruction: "Extract the answer" },
    caching: true,
    logger: testLogger(),
  };
}

function executesTo(data: unknown) {
  return vi.fn(async () => ({ result: { data, metadata: {} } as TestResult, cacheValue: data }));
}

async function runWithCache({
  get,
  set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" }),
  execute,
}: {
  get: ReturnType<typeof vi.fn>;
  set?: ReturnType<typeof vi.fn>;
  execute: () => Promise<{ result: TestResult; cacheValue?: unknown }>;
}) {
  return await cacheService.withCache({
    ...baseArgs(),
    context: cacheContext(get, set),
    onHit: (value): TestResult => ({ data: value, metadata: {} }),
    execute,
  });
}

function cacheContext(get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn>) {
  return {
    sessionId: "session-1",
    client: { get, set } as unknown as CacheClient,
    defaultCaching: false,
  };
}

function cachePage() {
  const frame = {
    frameId: "frame-1",
    getAccessibilityTree: async () => [],
  } as unknown as Frame;
  return {
    url: () => "https://example.com",
    frames: () => [frame],
    mainFrame: () => frame,
  };
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("cache-service-test") }, () => {});
}
