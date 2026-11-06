import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserbaseRequestParams,
  CacheMetadata,
  StagehandInitParams,
} from "@browserbasehq/stagehand-protocol/types";
import { requestBrowserbase } from "../clients/browserbaseClient.js";
import { CacheClient, type CacheGetRequest } from "../clients/cacheClient.js";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import { RPCClient } from "../clients/rpcClient.js";
import { RPCRouter } from "../rpcRouter.js";
import { createStagehandRuntime } from "../runtime.js";
import { StagehandLogger } from "../logger.js";
import type { Frame } from "../understudy/frame.js";
import { buildCacheContext, withCache } from "../services/cacheService.js";

const request: CacheGetRequest = {
  method: "extract",
  sessionId: "session-1",
  url: "https://example.com",
  cdpTree: { rootFrameId: "frame-1", frames: [] },
  data: { instruction: "Extract the answer" },
};
const init = { browserbase: "client", browser: { sessionId: "session-1" } } as StagehandInitParams;
let rpc: RPCClient;
let transport: ChromeRuntimeClient;
let cache: CacheClient;
let messages: { id?: number; method: string; params: unknown }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  messages = [];
  transport = new ChromeRuntimeClient(
    { send: (payload: string) => messages.push(JSON.parse(payload)) },
    "send",
  );
  rpc = new RPCClient(transport, new RPCRouter(createStagehandRuntime()));
  cache = buildCacheContext(init, (params, signal) =>
    requestBrowserbase(rpc, params, signal),
  )!.client;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected worker HTTP request"));
});
afterEach(() => {
  rpc.close();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function reply(id: number, operation: "get" | "set") {
  await transport.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        type: "response",
        status: 200,
        status_text: "OK",
        headers: {},
        body: JSON.stringify({
          success: true,
          data:
            operation === "get"
              ? { cacheKey: "key", hit: false }
              : { cacheKey: "key", written: true },
        }),
      },
    }),
  );
}

describe("client cache request budget", () => {
  it.each(["get", "set"] as const)(
    "bounds the complete %s wait and cancels the original RPC ID",
    async (operation) => {
      const result = cache[operation]({ ...request, value: { answer: 42 } });
      const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(4999);
      expect(rpc.pending.size).toBe(1);
      expect(messages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(messages).toMatchObject([
        {
          id: 1,
          method: "browserbase.request",
          params: { operation: `cache.${operation}`, remaining_timeout_ms: 5000 },
        },
        { method: "browserbase.cancel", params: { request_id: 1, reason: "timeout" } },
      ]);
      expect(rpc.pending.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await reply(1, operation);
      expect(rpc.pending.size).toBe(0);
    },
  );

  it("times out even while RPC dispatch is pending", async () => {
    let release!: () => void;
    const dispatch = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = transport.send.bind(transport);
    vi.spyOn(transport, "send").mockImplementationOnce(async (message) => {
      await dispatch;
      await send(message);
    });
    const rejected = expect(cache.get(request)).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(rpc.pending.size).toBe(0);
    expect(messages).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(messages).toMatchObject([
      { id: 1, method: "browserbase.request" },
      { method: "browserbase.cancel", params: { request_id: 1, reason: "timeout" } },
    ]);
  });

  it("forwards only the budget remaining after serializing the request", async () => {
    const result = cache.get({
      ...request,
      data: {
        toJSON() {
          vi.advanceTimersByTime(300);
          return request.data;
        },
      },
    });
    const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    expect(messages[0]?.params).toMatchObject({
      remaining_timeout_ms: 4700,
      body: JSON.stringify(request),
    });
    await vi.advanceTimersByTimeAsync(4700);
    await rejected;
    expect(performance.now()).toBe(5000);
  });

  it("does not dispatch when serialization exhausts the budget", async () => {
    await expect(
      cache.get({
        ...request,
        data: {
          toJSON() {
            vi.advanceTimersByTime(5000);
            return request.data;
          },
        },
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears completed timers and starts a separate budget for the write", async () => {
    const read = cache.get(request);
    await vi.advanceTimersByTimeAsync(4000);
    await reply(1, "get");
    await expect(read).resolves.toEqual({ cacheKey: "key", hit: false });
    expect(vi.getTimerCount()).toBe(0);
    const write = cache.set({ ...request, value: { answer: 42 } });
    expect(messages[1]?.params).toMatchObject({
      operation: "cache.set",
      remaining_timeout_ms: 5000,
    });
    await vi.advanceTimersByTimeAsync(4000);
    await reply(2, "set");
    await expect(write).resolves.toEqual({ cacheKey: "key", written: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(messages).toHaveLength(2);
  });

  it.each([
    { operation: "get", failure: "deadline", missReason: "timeout" },
    { operation: "set", failure: "deadline", missReason: "unknown" },
    { operation: "get", failure: "timeout", missReason: "timeout" },
    { operation: "get", failure: "network", missReason: "read_failed" },
  ] as const)(
    "keeps execution successful after cache $operation $failure",
    async ({ operation, failure, missReason }) => {
      const frame = {
        frameId: "frame-1",
        getAccessibilityTree: async () => [],
      } as unknown as Frame;
      const execute = vi.fn(async () => ({
        result: { data: { answer: 42 }, metadata: { cache: { status: "DISABLED" as const } } },
        cacheValue: operation === "set" ? { answer: 42 } : undefined,
      }));
      const result = withCache<{ data: unknown; metadata: { cache: CacheMetadata } }>({
        method: "extract",
        page: { url: () => request.url, frames: () => [frame], mainFrame: () => frame },
        data: request.data,
        context: { sessionId: request.sessionId, client: cache, defaultCaching: true },
        logger: new StagehandLogger({ tracer: trace.getTracer("cache-timeout-test") }, () => {}),
        onHit: (value) => ({ data: value, metadata: { cache: { status: "HIT" as const } } }),
        execute,
      });
      await vi.advanceTimersByTimeAsync(0);
      if (operation === "set") {
        await reply(1, "get");
        await vi.advanceTimersByTimeAsync(0);
      }
      if (failure === "deadline") {
        await vi.advanceTimersByTimeAsync(5000);
      } else {
        await transport.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { type: "error", reason: failure, message: "Cache transport failed" },
          }),
        );
      }
      expect(await result).toEqual({
        data: { answer: 42 },
        metadata: {
          cache: { status: "MISS", missReason },
        },
      });
      expect(execute).toHaveBeenCalledOnce();
      if (failure === "deadline") {
        expect(messages.at(-1)).toMatchObject({
          method: "browserbase.cancel",
          params: { request_id: operation === "get" ? 1 : 2, reason: "timeout" },
        });
      } else {
        expect(messages).toHaveLength(1);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("settles on disconnect without HTTP fallback or a remaining timer", async () => {
    const rejected = expect(cache.get(request)).rejects.toThrow("disconnected");
    rpc.close();
    await rejected;
    expect(rpc.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("client cache availability", () => {
  it.each([undefined, false, { threshold: 3 }])(
    "preserves the %j cache default with a client marker",
    (setting) => {
      const context = buildCacheContext({ ...init, cache: setting });
      expect(context?.sessionId).toBe("session-1");
      expect(context?.defaultCaching).toEqual(setting ?? true);
    },
  );

  it("requires a session and the client marker", () => {
    const adapter = vi.fn<(_: BrowserbaseRequestParams) => Promise<Response>>();
    expect(
      buildCacheContext({ browserbase: "client" } as StagehandInitParams, adapter),
    ).toBeUndefined();
    expect(
      buildCacheContext({ browser: init.browser } as StagehandInitParams, adapter),
    ).toBeUndefined();
    expect(adapter).not.toHaveBeenCalled();
  });

  it("fails an unavailable client request without selecting legacy HTTP", async () => {
    const context = buildCacheContext(init);
    await expect(context!.client.get(request)).rejects.toThrow(
      "Client Browserbase transport is unavailable",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
