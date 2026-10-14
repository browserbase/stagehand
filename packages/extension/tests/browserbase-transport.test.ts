import {
  createServer,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
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
import { buildGatewayContext, type GatewayContext } from "../llm/gatewayClient.js";
import { buildCacheContext } from "../services/cacheService.js";
import * as llmService from "../services/llmService.js";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };

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

describe("Browserbase HTTP transport baseline", () => {
  let server: Server;
  let gateway: GatewayContext;
  let cache: CacheClient;
  let respond: (attempt: number) => HttpReply | undefined;
  const requests: {
    method: string | undefined;
    url: string | undefined;
    headers: IncomingHttpHeaders;
    body: string;
  }[] = [];

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const reply = respond(requests.length);
      if (!reply) return;
      response.writeHead(reply.status, reply.headers);
      response.end(reply.body);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    gateway = { ...fixtures.connection, apiUrl: `http://127.0.0.1:${port}/services/v1` };
    cache = new CacheClient({ apiUrl: gateway.apiUrl, apiKey: gateway.apiKey });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  beforeEach(() => {
    requests.length = 0;
    respond = () => jsonReply(fixtures.gateway.response);
  });

  afterEach(() => vi.restoreAllMocks());

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

  it.each(fixtures.gateway.headers)("sends Gateway $name", async ({ configured, expected }) => {
    await generate({ modelName: "openai/gpt-5", headers: configured });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/services/v1/llm/responses",
      headers: { ...expected, "content-type": "application/json" },
    });
  });

  it.each(fixtures.httpFailures)(
    "preserves Gateway $name and attempt count",
    async ({ status, headers, body, gatewayAttempts }) => {
      respond = () => ({ status, headers, body });
      const timers = vi.spyOn(globalThis, "setTimeout");
      const error: unknown = await generate().catch((error: unknown) => error);
      expect(requests).toHaveLength(gatewayAttempts);
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
});
