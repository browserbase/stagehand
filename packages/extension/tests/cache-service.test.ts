import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheMetadata, StagehandInitParams } from "../../protocol/types.js";
import type { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import type { Frame } from "../understudy/frame.js";

// The cache service resolves locators to backendNodeIds through
// FrameSelectorResolver, which needs a live locator-world execution context.
// Tests fake the resolver and answer DOM.describeNode from the frame's fake
// session instead.
const resolver = vi.hoisted(() => ({
  resolveAtIndex: vi.fn(),
  resolveAll: vi.fn(),
}));

vi.mock("../understudy/selectorResolver.js", () => ({
  FrameSelectorResolver: class {
    static parseSelector(raw: string) {
      return { kind: "css", value: raw };
    }
    resolveAtIndex = resolver.resolveAtIndex;
    resolveAll = resolver.resolveAll;
  },
}));

beforeEach(() => {
  resolver.resolveAtIndex.mockReset();
  resolver.resolveAll.mockReset();
});

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

  it("includes locator descriptors in act, observe, and extract cache data", () => {
    const options = {
      locator: { selector: ".card", nth: 1 },
      ignoreLocators: [{ selector: ".ad", nth: 2 }],
    };

    expect(
      cacheService.buildActCacheData({
        pageId: "page-1",
        instruction: "Click the answer",
        options,
      }),
    ).toStrictEqual({
      input: "Click the answer",
      options: {
        variables: undefined,
        timeout: undefined,
        locator: { selector: ".card", nth: 1 },
        ignoreLocators: [{ selector: ".ad", nth: 2 }],
      },
    });

    expect(
      cacheService.buildObserveCacheData({
        pageId: "page-1",
        instruction: "Find the answer",
        options,
      }),
    ).toStrictEqual({
      instruction: "Find the answer",
      options: {
        variables: undefined,
        timeout: undefined,
        locator: { selector: ".card", nth: 1 },
        ignoreLocators: [{ selector: ".ad", nth: 2 }],
      },
    });

    expect(
      cacheService.buildExtractCacheData({
        pageId: "page-1",
        instruction: "Extract the answer",
        schema: { type: "object" },
        options: { ...options, screenshot: false },
      }),
    ).toStrictEqual({
      instruction: "Extract the answer",
      schema: { type: "object" },
      options: {
        timeout: undefined,
        screenshot: false,
        locator: { selector: ".card", nth: 1 },
        ignoreLocators: [{ selector: ".ad", nth: 2 }],
      },
    });
  });

  // The server hashes explicit undefined as null, so absent locator fields
  // must be omitted keys (not present-but-undefined) or the cache key would
  // fork away from unscoped requests.
  it("omits absent, empty, and index-free locator fields from cache data", () => {
    expect(
      cacheService.buildObserveCacheData({
        pageId: "page-1",
        instruction: "Find the answer",
        options: { ignoreLocators: [] },
      }),
    ).toStrictEqual({
      instruction: "Find the answer",
      options: { variables: undefined, timeout: undefined },
    });

    expect(
      cacheService.buildObserveCacheData({
        pageId: "page-1",
        instruction: "Find the answer",
        options: { locator: { selector: ".card" } },
      }),
    ).toStrictEqual({
      instruction: "Find the answer",
      options: {
        variables: undefined,
        timeout: undefined,
        locator: { selector: ".card" },
      },
    });
  });

  it("resolves the focus locator to the focusBackendNodeId the server scopes by", async () => {
    resolver.resolveAtIndex.mockResolvedValue({ objectId: "obj-focus", nodeId: null });
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" });
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });

    await cacheService.withCache({
      ...baseArgs({ page: cachePage(frameWithSession({ "obj-focus": 42 })) }),
      focusLocator: { selector: ".card", nth: 2 },
      context: cacheContext(get, set),
      onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute: executesTo({ answer: 42 }),
    });

    expect(resolver.resolveAtIndex).toHaveBeenCalledWith({ kind: "css", value: ".card" }, 2);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpTree: expect.objectContaining({ focusBackendNodeId: 42 }),
      }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpTree: expect.objectContaining({ focusBackendNodeId: 42 }),
      }),
    );
  });

  it("resolves an index-free focus locator at index 0, matching snapshot scoping", async () => {
    resolver.resolveAtIndex.mockResolvedValue({ objectId: "obj-focus", nodeId: null });
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" });

    await cacheService.withCache({
      ...baseArgs({ page: cachePage(frameWithSession({ "obj-focus": 42 })) }),
      focusLocator: { selector: ".card" },
      context: cacheContext(get, vi.fn().mockResolvedValue({ written: true, cacheKey: "key" })),
      onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute: executesTo({ answer: 42 }),
    });

    expect(resolver.resolveAtIndex).toHaveBeenCalledWith({ kind: "css", value: ".card" }, 0);
  });

  // A scoped request must never be keyed on an unscoped tree, so an
  // unresolvable focus locator skips the cache entirely instead of sending
  // the full-page hash.
  it("skips cache reads and writes when the focus locator does not resolve", async () => {
    resolver.resolveAtIndex.mockResolvedValue(null);
    const get = vi.fn();
    const set = vi.fn();
    const execute = executesTo({ answer: 42 });

    const result = await cacheService.withCache({
      ...baseArgs({ page: cachePage(frameWithSession({})) }),
      focusLocator: { selector: ".missing", nth: 3 },
      context: cacheContext(get, set),
      onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute,
    });

    expect(result.metadata).toStrictEqual({ cache: { status: "DISABLED" } });
    expect(execute).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("resolves ignore locators to the ignoredBackendNodeIds the server prunes", async () => {
    // No nth = every match; nth = that single match.
    resolver.resolveAll.mockResolvedValue([
      { objectId: "obj-ad-1", nodeId: null },
      { objectId: "obj-ad-2", nodeId: null },
    ]);
    resolver.resolveAtIndex.mockResolvedValue({ objectId: "obj-banner", nodeId: null });
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" });

    await cacheService.withCache({
      ...baseArgs({
        page: cachePage(frameWithSession({ "obj-ad-1": 11, "obj-ad-2": 12, "obj-banner": 13 })),
      }),
      ignoreLocators: [{ selector: ".ad" }, { selector: ".banner", nth: 1 }],
      context: cacheContext(get, vi.fn().mockResolvedValue({ written: true, cacheKey: "key" })),
      onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute: executesTo({ answer: 42 }),
    });

    expect(resolver.resolveAll).toHaveBeenCalledWith({ kind: "css", value: ".ad" });
    expect(resolver.resolveAtIndex).toHaveBeenCalledWith({ kind: "css", value: ".banner" }, 1);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpTree: expect.objectContaining({ ignoredBackendNodeIds: [11, 12, 13] }),
      }),
    );
  });

  // Ignore locators that match nothing are still a valid cached request — the
  // server accepts an empty id list and prunes nothing.
  it("sends an empty ignoredBackendNodeIds when ignore locators match nothing", async () => {
    resolver.resolveAll.mockResolvedValue([]);
    const get = vi.fn().mockResolvedValue({ hit: false, cacheKey: "key", missReason: "not_found" });

    await cacheService.withCache({
      ...baseArgs({ page: cachePage(frameWithSession({})) }),
      ignoreLocators: [{ selector: ".ad" }],
      context: cacheContext(get, vi.fn().mockResolvedValue({ written: true, cacheKey: "key" })),
      onHit: (value): TestResult => ({ data: value, metadata: { cache: { status: "DISABLED" } } }),
      execute: executesTo({ answer: 42 }),
    });

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpTree: expect.objectContaining({ ignoredBackendNodeIds: [] }),
      }),
    );
  });
});

interface TestResult {
  data: unknown;
  metadata: { cache: CacheMetadata };
}

function baseArgs(overrides: { page?: unknown } = {}) {
  return {
    method: "extract" as const,
    page: overrides.page ?? cachePage(),
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

/** A frame whose fake CDP session answers DOM.describeNode from a fixed
 * objectId → backendNodeId map, for locator-resolution tests. */
function frameWithSession(backendNodeIdsByObjectId: Record<string, number>) {
  return {
    frameId: "frame-1",
    getAccessibilityTree: async () => [],
    session: {
      send: vi.fn(async (method: string, params: { objectId: string }) => {
        if (method !== "DOM.describeNode") {
          throw new Error(`unexpected CDP call: ${method}`);
        }
        const backendNodeId = backendNodeIdsByObjectId[params.objectId];
        if (backendNodeId === undefined) {
          throw new Error(`unknown objectId: ${params.objectId}`);
        }
        return { node: { backendNodeId } };
      }),
    },
  } as unknown as Frame;
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("cache-service-test") }, () => {});
}
