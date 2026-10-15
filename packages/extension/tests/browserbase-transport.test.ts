import { type OutgoingHttpHeaders, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LLMGenerateParamsSchema,
  ModelConfigSchema,
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import {
  CacheClient,
  CacheGetRequestSchema,
  CacheSetRequestSchema,
} from "../clients/cacheClient.js";
import {
  buildGatewayContext,
  createGatewayLanguageModel,
  type GatewayContext,
} from "../llm/gatewayClient.js";
import { buildCacheContext } from "../services/cacheService.js";
import * as llmService from "../services/llmService.js";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };

import { generateText } from "ai";
import type { BrowserbaseRequestParams } from "@browserbasehq/stagehand-protocol/types";
import { boundFetch } from "../llm/boundFetch.js";
import {
  createHttpTestServer,
  listen,
  close,
  type CapturedRequest,
} from "../../sdk-ts/tests/helpers/httpServer.js";
import { createBrowserbaseTestBridge } from "./helpers/browserbaseBridge.js";

vi.mock("../llm/boundFetch.js", () => ({ boundFetch: vi.fn() }));
const initParams = StagehandInitParamsSchema.parse({
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "test", version: "1" },
  browserbase: "client",
  browser: { sessionId: fixtures.connection.sessionId },
});

interface HttpReply {
  status: number;
  headers: OutgoingHttpHeaders;
  body: string;
}

const input = LLMGenerateParamsSchema.parse(fixtures.gateway.input);
const getRequest = CacheGetRequestSchema.parse(fixtures.cache.get.request);
const setRequest = CacheSetRequestSchema.parse({
  ...getRequest,
  value: fixtures.cache.set.value,
  llmUsage: fixtures.cache.set.llmUsage,
});
const jsonReply = (body: unknown): HttpReply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Browserbase service endpoints", () => {
  it.each(fixtures.endpoints)("$name", ({ region, apiUrl, expected }) => {
    const init = StagehandInitParamsSchema.parse({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      clientInfo: { name: "test", version: "1" },
      apiKey: fixtures.connection.apiKey,
      apiUrl,
      browser: { sessionId: fixtures.connection.sessionId, region },
    });

    expect(buildGatewayContext(init)).toMatchObject({ apiUrl: expected });
    expect(buildCacheContext(init)?.client.transport).toMatchObject({ apiUrl: expected });
  });
});

describe("Browserbase HTTP transport", () => {
  let server: Server;
  let gateway: GatewayContext;
  let cache: CacheClient;
  let respond: (attempt: number) => HttpReply | undefined;
  const requests: CapturedRequest[] = [];
  let apiUrl: string;
  let bridge: ReturnType<typeof createBrowserbaseTestBridge>;
  let rpcRequests: BrowserbaseRequestParams[];
  let runtime: ReturnType<typeof createBrowserbaseTestBridge>["runtime"];
  const success = () => jsonReply(fixtures.gateway.response);

  beforeAll(async () => {
    server = createHttpTestServer((request, response) => {
      requests.push(request);
      const reply = respond(requests.length);
      if (!reply) return;
      response.writeHead(reply.status, reply.headers);
      response.end(reply.body);
    });
    apiUrl = `${await listen(server)}/services/v1`;
    cache = new CacheClient({ apiUrl, apiKey: fixtures.connection.apiKey });
  });
  afterAll(() => close(server));

  beforeEach(() => {
    requests.length = 0;
    respond = success;
    vi.mocked(boundFetch).mockRejectedValue(new Error("Unexpected worker HTTP request"));
    bridge = createBrowserbaseTestBridge({ ...fixtures.connection, apiUrl });
    ({ runtime, requests: rpcRequests } = bridge);
    runtime.state.setState({ status: "initialized", initParams });
    gateway = buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest)!;
  });

  afterEach(async () => {
    bridge.rpc.close();
    await Promise.all(bridge.pendingReplies);
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function generate(config?: unknown) {
    return llmService.generate(
      config === undefined ? undefined : ModelConfigSchema.parse(config),
      input,
      async () => {
        throw new Error("Unexpected custom client call");
      },
      gateway,
    );
  }

  describe.each(["client", "legacy"] as const)("Gateway via %s", (source) => {
    beforeEach(() => {
      if (source === "legacy") {
        gateway = { ...fixtures.connection, apiUrl };
        vi.mocked(boundFetch).mockImplementation(fetch);
      }
    });
    afterEach(() => {
      if (source === "client") {
        expect(rpcRequests).toHaveLength(requests.length);
        expect(rpcRequests.every(({ operation }) => operation === "gateway.responses")).toBe(true);
        expect(boundFetch).not.toHaveBeenCalled();
      } else expect(rpcRequests).toEqual([]);
    });
    it.each(fixtures.gateway.headers)("sends Gateway $name", async ({ configured, expected }) => {
      await expect(generate({ modelName: "openai/gpt-5", headers: configured })).resolves.toEqual(
        fixtures.gateway.result,
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "POST",
        url: "/services/v1/llm/responses",
        headers: { ...expected, "content-type": "application/json" },
      });
      expect(JSON.parse(requests[0]!.body)).toMatchObject({
        model: "openai/gpt-5",
        input: fixtures.gateway.requestInput,
      });
    });

    it.each(fixtures.httpFailures)(
      "preserves Gateway $name and attempt count",
      async ({ status, headers, body, gatewayAttempts }) => {
        respond = () => ({ status, headers, body });
        const timers = vi.spyOn(globalThis, "setTimeout");
        const error: unknown = await generate().catch((error: unknown) => error);
        expect(requests).toHaveLength(gatewayAttempts);
        expect(new Set(requests.map(({ body }) => body)).size).toBe(1);
        const lastError =
          error && typeof error === "object" && "lastError" in error ? error.lastError : error;
        expect(lastError).toMatchObject({
          statusCode: status,
          responseBody: body,
          responseHeaders: expect.objectContaining(headers),
          isRetryable: gatewayAttempts > 1,
        });
        if (gatewayAttempts > 1) {
          expect(error).toMatchObject({ reason: "maxRetriesExceeded" });
          const delays = timers.mock.calls.map((call) => call[1]);
          expect(delays.filter((delay) => delay === 0)).toHaveLength(2);
          expect(delays).not.toContain(2000);
          expect(delays).not.toContain(4000);
        }
      },
    );

    it("retries an upstream connection reset without changing the request", async () => {
      respond = (attempt) => {
        if (attempt === 1) {
          server.closeAllConnections();
          return undefined;
        }
        return jsonReply(fixtures.gateway.response);
      };
      const timers = vi.spyOn(globalThis, "setTimeout");

      await expect(generate()).resolves.toEqual(fixtures.gateway.result);

      expect(requests).toHaveLength(2);
      expect(requests[1]?.body).toBe(requests[0]?.body);
      expect(timers.mock.calls.map((call) => call[1])).toContain(2000);
    });

    it("uses two- and four-second backoff without retry headers", async () => {
      respond = (attempt) =>
        attempt < 3
          ? { status: 503, headers: {}, body: "fixture unavailable" }
          : jsonReply(fixtures.gateway.response);
      const timers = vi.spyOn(globalThis, "setTimeout");

      await expect(generate()).resolves.toEqual(fixtures.gateway.result);

      expect(requests).toHaveLength(3);
      const delays = timers.mock.calls.map((call) => call[1]);
      expect(delays).toContain(2000);
      expect(delays).toContain(4000);
      expect(new Set(requests.map((request) => request.body)).size).toBe(1);
    });
  });

  it.each(["get", "set"] as const)(
    "sends cache %s with its unchanged JSON payload",
    async (method) => {
      respond = () => jsonReply(fixtures.cache[method].response);
      const payload = method === "get" ? getRequest : setRequest;
      const result = method === "get" ? await cache.get(getRequest) : await cache.set(setRequest);

      expect(result).toEqual(fixtures.cache[method].response.data);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "POST",
        url: `/services/v1/cache/${method}`,
        headers: {
          "content-type": "application/json",
          "x-bb-api-key": fixtures.connection.apiKey,
        },
        body: JSON.stringify(payload),
      });
      expect(requests[0]?.headers).not.toHaveProperty("authorization");
      expect(requests[0]?.headers).not.toHaveProperty("x-bb-session-id");
    },
  );

  describe.each(["get", "set"] as const)("cache %s failures", (method) => {
    const call = () => (method === "get" ? cache.get(getRequest) : cache.set(setRequest));

    it.each(fixtures.httpFailures)("does not retry $name", async ({ status, headers, body }) => {
      respond = () => ({ status, headers, body });
      await expect(call()).rejects.toThrow(
        `Cache request /cache/${method} failed with status ${status}`,
      );
      expect(requests).toHaveLength(1);
    });

    it.each(fixtures.cache.envelopeFailures)("reports $name", async ({ body, message }) => {
      respond = () => jsonReply(body);
      await expect(call()).rejects.toThrow(message);
      expect(requests).toHaveLength(1);
    });

    it("reports a non-JSON success body", async () => {
      respond = () => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "not-json",
      });
      await expect(call()).rejects.toBeInstanceOf(SyntaxError);
      expect(requests).toHaveLength(1);
    });
  });

  it("aborts a pending cache request after five seconds without retrying", async () => {
    respond = () => undefined;
    const startedAt = performance.now();

    await expect(cache.get(getRequest)).rejects.toMatchObject({ name: "TimeoutError" });

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(4900);
    expect(requests).toHaveLength(1);
  });
  describe("Model Gateway through client HTTP", () => {
    it.each(["Authorization", "authorization", "AUTHORIZATION"])(
      "preserves explicit empty %s",
      async (name) => {
        await generate({ modelName: "openai/gpt-5", headers: { [name]: "" } });
        expect(rpcRequests[0]!.headers.authorization).toBe("");
        expect(requests[0]!.headers.authorization).toBe("");
      },
    );

    it("omits only the generated authorization default", async () => {
      await generate();
      expect(rpcRequests[0]!.headers).not.toHaveProperty("authorization");
      expect(rpcRequests[0]!.headers).not.toHaveProperty("x-bb-api-key");
      expect(requests[0]!.headers.authorization).toBe(`Bearer ${fixtures.connection.apiKey}`);
      const literal = "Bearer stagehand-client-gateway";
      await generate({
        modelName: "openai/gpt-5",
        headers: { Authorization: literal, "x-custom": literal },
      });
      expect(rpcRequests[1]!.headers).toMatchObject({
        authorization: literal,
        "x-custom": literal,
      });
      expect(requests[1]!.headers.authorization).toBe(literal);
    });

    it("omits the automatic model through both service and runtime entry points", async () => {
      await generate({ modelName: "groq/openai/future-model" });
      await generate();
      await expect(runtime.generateLlm(input)).resolves.toEqual(fixtures.gateway.result);
      const { model, ...rest } = JSON.parse(requests[0]!.body) as Record<string, unknown>;
      expect(model).toBe("groq/openai/future-model");
      expect(JSON.parse(requests[1]!.body)).toEqual(rest);
      expect(JSON.parse(requests[2]!.body)).toEqual(rest);
      expect(boundFetch).not.toHaveBeenCalled();
    });

    it("leaves direct provider inference in the worker", async () => {
      vi.mocked(boundFetch).mockResolvedValue(
        new Response(success().body, { headers: { "content-type": "application/json" } }),
      );
      await expect(
        generate({ modelName: "openai/gpt-5", apiKey: "provider-key" }),
      ).resolves.toEqual(fixtures.gateway.result);
      expect(boundFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: "Bearer provider-key" }),
        }),
      );
      expect(rpcRequests).toEqual([]);
    });

    it("preserves custom LLM generation and stop-sequence rejection", async () => {
      const custom = vi.fn().mockResolvedValue(fixtures.gateway.result);
      await llmService.generate({ source: "client" }, input, custom, gateway);
      expect(custom).toHaveBeenCalledOnce();
      await expect(
        llmService.generate(undefined, { ...input, stopSequences: ["STOP"] }, custom, gateway),
      ).rejects.toThrow("does not support stop sequences");
      expect(rpcRequests).toEqual([]);
      expect(boundFetch).not.toHaveBeenCalled();
    });

    it("never falls back when the client adapter is missing or disconnected", async () => {
      const context = buildGatewayContext(
        { ...initParams, apiKey: "legacy-key", apiUrl },
        undefined,
      );
      await expect(llmService.generate(undefined, input, vi.fn(), context)).rejects.toThrow(
        "transport is unavailable",
      );
      bridge.rpc.close();
      await expect(generate()).rejects.toThrow("connection is disconnected");
      expect(rpcRequests).toEqual([]);
      expect(boundFetch).not.toHaveBeenCalled();
    });

    it("passes AI SDK cancellation to the client request", async () => {
      const controller = new AbortController();
      let forwardedSignal: AbortSignal | undefined;
      const request = vi.fn((_params: BrowserbaseRequestParams, signal?: AbortSignal) => {
        forwardedSignal = signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      });
      const model = createGatewayLanguageModel(undefined, {
        source: "client",
        sessionId: "session",
        request,
      });
      const pending = generateText({ model, prompt: "Hi", abortSignal: controller.signal });
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      controller.abort();
      await rejected;
      expect(forwardedSignal?.aborted).toBe(true);
      expect(boundFetch).not.toHaveBeenCalled();
    });

    it("does not infer client availability from an installed adapter alone", () => {
      const request = runtime.adapters.clientBrowserbaseRequest;
      expect(
        buildGatewayContext({ ...initParams, browserbase: undefined }, request),
      ).toBeUndefined();
      expect(buildGatewayContext({ ...initParams, browser: undefined }, request)).toBeUndefined();
      expect(
        buildGatewayContext({ ...initParams, browserbase: undefined, apiKey: "legacy" }, request),
      ).toMatchObject({ apiKey: "legacy", apiUrl: "https://api.stagehand.browserbase.com/v1" });
      expect(buildGatewayContext(initParams, request)).toEqual({
        source: "client",
        sessionId: fixtures.connection.sessionId,
        request,
      });
    });
  });
});
