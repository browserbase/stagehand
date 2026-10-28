import type { Server, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeWireValue,
  wireSchema,
} from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import {
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { ModelConfig, StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import type { CallbackBatchFunction } from "../callbackBatch.js";
import type { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import type { RPCClient } from "../clients/rpcClient.js";
import type { createStagehandRuntime } from "../runtime.js";

import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };
import { createHttpTestServer, listen, close } from "../../sdk-ts/tests/helpers/httpServer.js";
import { createBrowserbaseTestBridge, type WireMessage } from "./helpers/browserbaseBridge.js";

const schema = {
  type: "object",
  properties: { answer: { type: "number" } },
  required: ["answer"],
  additionalProperties: false,
};
const params = { pageId: "page-1", instruction: "Extract the answer", schema };
const dataFor = (name?: string): Record<string, string | number | boolean> =>
  name === "Metadata" ? { progress: "Complete", completed: true } : { answer: 42 };
const completion = (name?: string) => {
  const response = structuredClone(fixtures.gateway.response);
  response.output[0]!.content[0]!.text = JSON.stringify(dataFor(name));
  return response;
};
type HttpRequest = { path: string; body: Record<string, unknown> };
let server: Server;
let apiUrl: string;
let runtime: ReturnType<typeof createStagehandRuntime>;
let transport: ChromeRuntimeClient;
let rpc: RPCClient;
let init: StagehandInitParams;
let nextId: number;
const requests: HttpRequest[] = [];
let messages: WireMessage[];
let pendingReplies: Promise<void>[];
const captureSnapshot = vi.fn(async () => ({ combinedTree: "Answer: 42", combinedUrlMap: {} }));
let cacheHit: boolean;
let failCache: boolean;
let retryGateway: boolean;
let holdPath: string | undefined;
let heldResponse: (() => void) | undefined;

beforeAll(async () => {
  server = createHttpTestServer((request, response) => {
    const captured = {
      path: request.url!,
      body: JSON.parse(request.body) as Record<string, unknown>,
    };
    requests.push(captured);
    if (captured.path === holdPath) {
      holdPath = undefined;
      heldResponse = () => respond(captured, response);
    } else respond(captured, response);
  });
  apiUrl = await listen(server);
});
afterAll(() => close(server));
function respond(request: HttpRequest, response: ServerResponse) {
  const gateway = request.path.endsWith("/llm/responses");
  if ((!gateway && failCache) || (gateway && retryGateway)) {
    if (gateway) retryGateway = false;
    response.writeHead(gateway ? 429 : 503, {
      "content-type": "application/json",
      "retry-after-ms": "1",
    });
    response.end(JSON.stringify({ error: { message: "Try again" } }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  const format = request.body.text as { format?: { name?: string } } | undefined;
  response.end(
    JSON.stringify(
      gateway
        ? completion(format?.format?.name)
        : {
            success: true,
            data: request.path.endsWith("/cache/get")
              ? {
                  cacheKey: "key",
                  hit: cacheHit,
                  ...(cacheHit
                    ? { value: { answer: 7 }, hitCount: 3, threshold: 2 }
                    : { missReason: "not_found" }),
                }
              : { cacheKey: "key", written: true },
          },
    ),
  );
}
beforeEach(() => {
  requests.length = 0;
  captureSnapshot.mockClear();
  cacheHit = failCache = retryGateway = false;
  holdPath = undefined;
  heldResponse = undefined;
  nextId = 100;
  ({ runtime, transport, rpc, messages, pendingReplies } = createBrowserbaseTestBridge(
    { apiUrl: `${apiUrl}/v1`, apiKey: "bb-client-key", sessionId: "session-test" },
    (input) => {
      const data = dataFor(
        input.responseFormat?.type === "json_schema" ? input.responseFormat.name : undefined,
      );
      return {
        role: "assistant",
        content: { type: "text", text: JSON.stringify(data) },
        outputFormat: "json_schema",
        structuredContent: data,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  ));
  init = StagehandInitParamsSchema.parse({
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    clientInfo: { name: "test", version: "1" },
    browserbase: "client",
    browser: { sessionId: "session-test" },
  });
  initialize();
  // Only the browser surface is stubbed; controllers, inference, AI SDK, cache,
  // callback execution, and both directions of RPC use their real implementations.
  const frame = { frameId: "frame-1", getAccessibilityTree: async () => [] };
  const page = {
    url: () => "https://example.com",
    frames: () => [frame],
    mainFrame: () => frame,
    captureSnapshot,
  };
  vi.spyOn(runtime, "resolvePage").mockReturnValue(page as never);
  vi.spyOn(runtime, "contextActivePage").mockResolvedValue({ pageId: "page-1" });
});
afterEach(async () => {
  heldResponse?.();
  heldResponse = undefined;
  rpc.close();
  await Promise.all(pendingReplies.splice(0));
  await runtime.close();
  vi.restoreAllMocks();
});
function initialize() {
  runtime.state.setState({ status: "initialized", initParams: init });
}
function reverseMethods() {
  return messages.flatMap((message) =>
    message.method === "browserbase.request" || message.method === "llm.generate"
      ? [message.method]
      : [],
  );
}
function paths() {
  return requests.map((request) => request.path);
}
function startExtract(batch = true, model?: ModelConfig) {
  const id = nextId++;
  const callback: CallbackBatchFunction = async (batch) =>
    batch.extract("Extract the answer", schema, model ? { model } : undefined);
  const done = transport.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: batch ? "stagehand.callback_batch" : "stagehand.extract",
      params: encodeWireValue(
        batch ? { callbackSource: callback.toString(), options: { timeout: 10000 } } : params,
      ),
    }),
    batch ? { callback } : undefined,
  );
  return { id, done };
}
async function extract(batch = true, model?: ModelConfig) {
  const { id, done } = startExtract(batch, model);
  await done;
  const message = messages.find((message) => message.id === id && !message.method)!;
  expect(message.error).toBeUndefined();
  return batch
    ? message.result
    : wireSchema(StagehandMethods.stagehandExtract.result).parse(message.result);
}

describe("combined Browserbase routing", () => {
  it("preserves client cache and Gateway retry behavior inside a batch", async () => {
    retryGateway = true;
    expect(await extract()).toMatchObject({
      value: {
        data: { answer: 42 },
        metadata: {
          cache: { status: "MISS", missReason: "not_found" },
          usage: { inputTokens: 20, outputTokens: 10 },
        },
      },
    });
    expect(paths()).toEqual([
      "/v1/cache/get",
      "/v1/llm/responses",
      "/v1/llm/responses",
      "/v1/llm/responses",
      "/v1/cache/set",
    ]);
    for (const request of requests.filter((request) => request.path.endsWith("/responses")))
      expect(request.body).not.toHaveProperty("model");
    expect(requests.at(-1)?.body).toMatchObject({
      value: { answer: 42 },
      llmUsage: { inputTokens: 20, outputTokens: 10 },
    });
    expect(reverseMethods()).toEqual(Array(5).fill("browserbase.request"));
  });

  it.each([false, true])(
    "falls back from cache failures through real inference (batch=%s)",
    async (batch) => {
      failCache = true;
      const result = await extract(batch);
      expect(batch ? (result as { value: unknown }).value : result).toMatchObject({
        data: { answer: 42 },
        metadata: { cache: { status: "MISS", missReason: "read_failed" } },
      });
      expect(paths()).toEqual([
        "/v1/cache/get",
        "/v1/llm/responses",
        "/v1/llm/responses",
        "/v1/cache/set",
      ]);
    },
  );

  it("uses the instance custom client from a batch and still uses client caching", async () => {
    init = { ...init, model: { source: "client" } };
    initialize();
    expect(await extract()).toMatchObject({ value: { data: { answer: 42 } } });
    expect(paths()).toEqual(["/v1/cache/get", "/v1/cache/set"]);
    expect(reverseMethods()).toEqual([
      "browserbase.request",
      "llm.generate",
      "llm.generate",
      "browserbase.request",
    ]);
  });

  it.each([
    undefined,
    { source: "client" } as const,
    { modelName: "openai/gpt-5", apiKey: "provider-key" } as const,
  ])("skips inference on a cache hit with model %j", async (model) => {
    init = { ...init, model };
    initialize();
    cacheHit = true;
    expect(await extract()).toMatchObject({
      value: {
        data: { answer: 7 },
        metadata: { cache: { status: "HIT", count: 3, threshold: 2 }, usage: { inputTokens: 0 } },
      },
    });
    expect(paths()).toEqual(["/v1/cache/get"]);
    expect(reverseMethods()).toEqual(["browserbase.request"]);
    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { source: "client" } as const,
    { modelName: "openai/gpt-5", apiKey: "provider-key" } as const,
  ])("replaces the %j default with a complete batch method override", async (model) => {
    init = { ...init, model };
    initialize();
    await extract(true, { modelName: "anthropic/claude-sonnet-4-6" });
    expect(reverseMethods()).toEqual(Array(4).fill("browserbase.request"));
    for (const request of requests) {
      if (request.path.endsWith("/responses"))
        expect(request.body.model).toBe("anthropic/claude-sonnet-4-6");
      else expect(request.body.data).not.toHaveProperty("model");
    }
  });
});

describe("close during reverse Browserbase HTTP", () => {
  it.each(["/v1/llm/responses", "/v1/cache/set"])(
    "drains the batch before closing while %s is pending",
    async (path) => {
      holdPath = path;
      const active = startExtract();
      await vi.waitFor(() => expect(heldResponse).toBeDefined());
      const closeId = nextId++;
      const close = transport.receive(
        JSON.stringify({ jsonrpc: "2.0", id: closeId, method: "stagehand.close", params: {} }),
      );
      await transport.receive(
        JSON.stringify({ jsonrpc: "2.0", id: 999, method: "stagehand.metrics", params: {} }),
      );
      expect(messages.find((message) => message.id === 999)).toMatchObject({
        error: { message: "Stagehand instance is closing" },
      });
      expect(messages.find((message) => message.id === closeId)).toBeUndefined();
      expect(rpc.pending.size).toBe(1);
      heldResponse!();
      heldResponse = undefined;
      await Promise.all([active.done, close]);
      expect(
        messages.filter((message) => message.id === active.id || message.id === closeId),
      ).toMatchObject([
        { id: active.id, result: { value: { data: { answer: 42 } } } },
        { id: closeId, result: { closed: true } },
      ]);
      expect(rpc.pending.size).toBe(0);
      expect(runtime.state.getState().status).toBe("idle");
      expect(messages.some((message) => message.method === "browserbase.cancel")).toBe(false);
    },
  );

  it("drains the active lease after disconnect without replaying inference", async () => {
    holdPath = "/v1/llm/responses";
    const active = startExtract();
    const failedDelivery = expect(active.done).rejects.toThrow("closed");
    await vi.waitFor(() => expect(heldResponse).toBeDefined());
    const close = runtime.disposeStagehandInstance();
    rpc.close(new Error("Connection lost"));
    await failedDelivery;
    await close;
    expect(runtime.state.getState().status).toBe("idle");
    expect(rpc.pending.size).toBe(0);
    expect(paths()).toEqual(["/v1/cache/get", "/v1/llm/responses"]);
  });
});
