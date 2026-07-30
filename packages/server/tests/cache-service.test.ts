import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import type { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import type { Frame } from "../understudy/frame.js";

describe("cache service", () => {
  it("marks a cache hit without executing the live request", async () => {
    const get = vi.fn().mockResolvedValue({ hit: true, value: { answer: 42 }, cacheKey: "key" });
    const execute = vi.fn();

    const result = await cacheService.withCache({
      method: "extract",
      page: cachePage(),
      data: { instruction: "Extract the answer" },
      caching: true,
      context: cacheContext(get, vi.fn()),
      logger: testLogger(),
      onHit: (value) => ({ data: value, metadata: {} }),
      execute,
    });

    expect(result).toStrictEqual({ data: { answer: 42 }, metadata: { cacheStatus: "HIT" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks a miss and persists the cache value", async () => {
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key" });
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
    const execute = vi.fn().mockResolvedValue({
      result: { data: { answer: 42 }, metadata: {} },
      cacheValue: { answer: 42 },
    });

    const result = await cacheService.withCache({
      method: "extract",
      page: cachePage(),
      data: { instruction: "Extract the answer" },
      caching: true,
      context: cacheContext(get, set),
      logger: testLogger(),
      onHit: (value) => ({ data: value, metadata: {} }),
      execute,
    });

    expect(result).toStrictEqual({ data: { answer: 42 }, metadata: { cacheStatus: "MISS" } });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: { answer: 42 } }));
  });
});

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
