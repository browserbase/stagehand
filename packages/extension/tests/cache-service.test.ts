import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import type { CacheMetadata, StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import type { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import type { Frame } from "../understudy/frame.js";

describe("cache service", () => {
  it("uses an explicit Stagehand API URL for the cache client", () => {
    const context = cacheService.buildCacheContext({
      apiKey: "bb-key",
      apiUrl: "https://api.stagehand.dev.browserbase.com/",
      browser: { sessionId: "session-id", region: "eu-central-1" },
    } as StagehandInitParams);

    expect(context?.client.apiUrl).toBe("https://api.stagehand.dev.browserbase.com/v1");
  });

  it("marks a cache hit without executing the live request", async () => {
    const get = vi.fn().mockResolvedValue({ hit: true, value: { answer: 42 }, cacheKey: "key" });
    const execute = executesTo({ answer: 0 });

    const result = await runWithCache({ get, execute });

    expect(result).toStrictEqual({
      data: { answer: 42 },
      metadata: { cache: { status: "HIT" } },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  // ageMs is in the fixture because the API sends it, and deliberately absent
  // from the assertion: it is logged, not surfaced on the result.
  it("reports hit count, threshold, and token savings on a hit", async () => {
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
      cache: {
        status: "HIT",
        count: 3,
        threshold: 2,
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
      metadata: { cache: { status: "MISS", missReason: "not_found" } },
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

    expect(result.metadata.cache).toStrictEqual({
      status: "MISS",
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
      cache: { status: "MISS", missReason: "read_failed" },
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
      cache: { status: "MISS", missReason: "replay_failed", count: 4 },
    });
    expect(execute).toHaveBeenCalled();
  });

  it("reports DISABLED when no cache lookup runs", async () => {
    const result = await cacheService.withCache({
      ...baseArgs(),
      caching: false,
      context: cacheContext(vi.fn(), vi.fn()),
      onHit: (value) => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute: executesTo({ answer: 42 }),
    });

    expect(result.metadata).toStrictEqual({ cache: { status: "DISABLED" } });
  });

  it("omits locator descriptors from act, observe, and extract cache data", () => {
    expect(
      cacheService.buildActCacheData({
        pageId: "page-1",
        instruction: "Click the answer",
        options: {
          locator: { selector: ".card", nth: 1 },
          ignoreLocators: [{ selector: ".ad", nth: 2 }],
        },
      }),
    ).toStrictEqual({
      input: "Click the answer",
      options: {
        variables: undefined,
        timeout: undefined,
      },
    });

    expect(
      cacheService.buildObserveCacheData({
        pageId: "page-1",
        instruction: "Find the answer",
        options: {
          locator: { selector: ".card", nth: 1 },
          ignoreLocators: [{ selector: ".ad", nth: 2 }],
        },
      }),
    ).toStrictEqual({
      instruction: "Find the answer",
      options: {
        variables: undefined,
        timeout: undefined,
      },
    });

    expect(
      cacheService.buildExtractCacheData({
        pageId: "page-1",
        instruction: "Extract the answer",
        schema: { type: "object" },
        options: {
          locator: { selector: ".card", nth: 1 },
          ignoreLocators: [{ selector: ".ad", nth: 2 }],
          screenshot: false,
        },
      }),
    ).toStrictEqual({
      instruction: "Extract the answer",
      schema: { type: "object" },
      options: {
        timeout: undefined,
        screenshot: false,
      },
    });
  });

  it("bypasses cache reads and writes when the caller marks a request as bypassed", async () => {
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" });
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
    const execute = executesTo({ answer: 42 });

    const result = await cacheService.withCache({
      ...baseArgs(),
      bypass: cacheService.shouldBypassCacheForLocatorScope({
        locator: { selector: ".card", nth: 2 },
      }),
      context: cacheContext(get, set),
      onHit: (value): TestResult => ({
        data: value,
        metadata: { cache: { status: "DISABLED" } },
      }),
      execute,
    });

    expect(result.metadata).toStrictEqual({ cache: { status: "DISABLED" } });
    expect(execute).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

interface TestResult {
  data: unknown;
  metadata: { cache: CacheMetadata };
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
  return vi.fn(async () => ({
    result: { data, metadata: { cache: { status: "DISABLED" } } } as TestResult,
    cacheValue: data,
  }));
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
    onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
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

function cachePage(frame: Frame = defaultFrame()) {
  return {
    url: () => "https://example.com",
    frames: () => [frame],
    mainFrame: () => frame,
  };
}

function defaultFrame() {
  return {
    frameId: "frame-1",
    getAccessibilityTree: async () => [],
  } as unknown as Frame;
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("cache-service-test") }, () => {});
}
