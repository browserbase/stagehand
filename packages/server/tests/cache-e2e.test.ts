import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import type { Frame } from "../understudy/frame.js";

/**
 * End-to-end test of the cache path with nothing mocked between the service
 * and the wire: a real CacheClient talks real HTTP to a local server standing
 * in for stagehand-api-v3's POST /v1/cache/{get,set}. The service tests mock
 * the client, so only this file proves that an actual API payload maps onto
 * `metadata.cache` — the seam where a renamed or dropped field (as `tokensSaved`
 * was) otherwise goes unnoticed.
 *
 * Response fixtures are the API's real shapes, captured from a live instance.
 */

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let server: Server;
let context: cacheService.CacheContext;
const requests: CapturedRequest[] = [];

/** Per-scenario response bodies; each test sets what the API should answer. */
let getResponse: () => { status: number; body: unknown };
let setResponse: () => { status: number; body: unknown };

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        body: JSON.parse(body) as Record<string, unknown>,
      });
      const { status, body: payload } = req.url?.endsWith("/cache/get")
        ? getResponse()
        : setResponse();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  context = {
    sessionId: "session-e2e",
    client: new CacheClient(`http://127.0.0.1:${port}/v1`, "bb-api-key"),
    defaultCaching: false,
  };
});

afterAll(async () => {
  // close() alone waits on live sockets, so a request still in flight would
  // outlive the suite as a leaked handle. Stop accepting first, then drop the
  // connections so close() can settle — the order the SDK's integration
  // closeServer helper uses; reversing it lets a connection accepted after the
  // snapshot keep close() waiting.
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

beforeEach(() => {
  requests.length = 0;
  getResponse = () => ok({ cacheKey: "key", hit: false, missReason: "not_found" });
  setResponse = () => ok({ cacheKey: "key", written: true });
});

async function extractThroughCache(options?: { caching?: boolean | { threshold: number } }) {
  return await cacheService.withCache({
    method: "extract",
    page: cachePage(),
    data: { instruction: "Extract the answer" },
    caching: options?.caching ?? true,
    context,
    logger: new StagehandLogger({ tracer: trace.getTracer("cache-e2e-test") }, () => {}),
    onHit: (value) => ({
      data: value,
      metadata: { cache: { status: "DISABLED" as const } },
    }),
    execute: async () => ({
      result: { data: { answer: 42 }, metadata: { cache: { status: "DISABLED" as const } } },
      cacheValue: { answer: 42 },
      llmUsage: { inputTokens: 900, outputTokens: 40, llmDurationMs: 2200 },
    }),
  });
}

describe("cache metadata end to end", () => {
  it("reports a cold miss and writes the computed value with its usage", async () => {
    const result = await extractThroughCache();

    expect(result.metadata.cache).toStrictEqual({
      status: "MISS",
      missReason: "not_found",
    });

    // The write must carry llmUsage, or the API has nothing to compute a
    // future hit's tokensSaved from.
    const write = requests.find((request) => request.url.endsWith("/cache/set"));
    expect(write?.body).toMatchObject({
      value: { answer: 42 },
      llmUsage: { inputTokens: 900, outputTokens: 40, llmDurationMs: 2200 },
    });
  });

  it("reports a hit with count, threshold, and token savings", async () => {
    getResponse = () =>
      ok({
        cacheKey: "key",
        hit: true,
        value: { answer: 42 },
        hitCount: 2,
        threshold: 1,
        ageMs: 412,
        tokensSaved: { input: 8000, output: 120, total: 8120 },
      });

    const result = await extractThroughCache();

    expect(result.metadata.cache).toStrictEqual({
      status: "HIT",
      count: 2,
      threshold: 1,
      tokensSaved: { inputTokens: 8000, outputTokens: 120, totalTokens: 8120 },
    });
    expect(requests.some((request) => request.url.endsWith("/cache/set"))).toBe(false);
  });

  it("reports a hit whose entry recorded no usage without inventing savings", async () => {
    getResponse = () =>
      ok({ cacheKey: "key", hit: true, value: { answer: 42 }, hitCount: 5, threshold: 1 });

    const result = await extractThroughCache();

    expect(result.metadata.cache).toStrictEqual({ status: "HIT", count: 5, threshold: 1 });
  });

  it("reports progress toward the threshold on a threshold miss", async () => {
    getResponse = () =>
      ok({ cacheKey: "key", hit: false, missReason: "threshold", threshold: 3, hitCount: 2 });

    const result = await extractThroughCache();

    expect(result.metadata.cache).toStrictEqual({
      status: "MISS",
      missReason: "threshold",
      count: 2,
      threshold: 3,
    });
  });

  it("distinguishes an API failure from a cold cache", async () => {
    getResponse = () => ({ status: 500, body: { success: false, message: "boom" } });

    const result = await extractThroughCache();

    expect(result.metadata.cache).toStrictEqual({ status: "MISS", missReason: "read_failed" });
  });

  it("distinguishes an unusable cached value from a cold cache", async () => {
    getResponse = () => ok({ cacheKey: "key", hit: true, value: { answer: 1 }, hitCount: 4 });

    const result = await cacheService.withCache({
      method: "extract",
      page: cachePage(),
      data: { instruction: "Extract the answer" },
      caching: true,
      context,
      logger: new StagehandLogger({ tracer: trace.getTracer("cache-e2e-test") }, () => {}),
      onHit: (): {
        data: unknown;
        metadata: { cache: { status: "HIT" | "MISS" | "DISABLED" } };
      } => {
        throw new Error("cached value no longer applies to this page");
      },
      execute: async () => ({
        result: { data: { answer: 42 }, metadata: { cache: { status: "DISABLED" as const } } },
        cacheValue: { answer: 42 },
      }),
    });

    expect(result.metadata.cache).toStrictEqual({
      status: "MISS",
      missReason: "replay_failed",
      count: 4,
    });
  });

  it("reports DISABLED and never calls the API when caching is off", async () => {
    const result = await extractThroughCache({ caching: false });

    expect(result.metadata.cache).toStrictEqual({ status: "DISABLED" });
    expect(requests).toHaveLength(0);
  });

  it("threads a per-request threshold to the API on both get and set", async () => {
    await extractThroughCache({ caching: { threshold: 3 } });

    for (const request of requests) {
      expect(request.body).toMatchObject({
        sessionId: "session-e2e",
        data: { options: { cacheThreshold: 3 } },
      });
    }
    expect(requests.map((request) => request.url)).toStrictEqual([
      "/v1/cache/get",
      "/v1/cache/set",
    ]);
  });
});

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
