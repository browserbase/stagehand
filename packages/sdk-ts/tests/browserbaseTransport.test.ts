import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserbaseRequestParamsSchema,
  BrowserbaseRequestResultSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { BrowserbaseRequestParams } from "@browserbasehq/stagehand-protocol/types";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };
import type { BrowserbaseConnection } from "../src/browserbaseConnection.js";
import { executeBrowserbaseRequest } from "../src/browserbaseTransport.js";
import { createHttpTestServer, listen, close, type CapturedRequest } from "./helpers/httpServer.js";

const params: BrowserbaseRequestParams = {
  operation: "gateway.responses",
  headers: { "content-type": "application/json" },
  body: '{ "input": "héllo 🌎" }',
};

let server: Server;
let redirectServer: Server;
let redirectOrigin: string;
let connection: BrowserbaseConnection;
let respond: (request: CapturedRequest, response: ServerResponse) => void;
let onRequest: (() => void) | undefined;
const requests: CapturedRequest[] = [];
const redirectHeaders: IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = createHttpTestServer((request, response) => {
    requests.push(request);
    respond(request, response);
    onRequest?.();
  });
  connection = { ...fixtures.connection, apiUrl: `${await listen(server)}/services/v1` };
  redirectServer = createServer((request, response) => {
    redirectHeaders.push(request.headers);
    response.end("redirect destination");
  });
  redirectOrigin = await listen(redirectServer);
});
afterAll(async () => {
  await Promise.all([close(server), close(redirectServer)]);
});
beforeEach(() => {
  requests.length = 0;
  redirectHeaders.length = 0;
  onRequest = undefined;
  respond = (_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(fixtures.gateway.response));
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Browserbase HTTP executor", () => {
  it.each([
    ["gateway.responses", "/llm/responses"],
    ["cache.get", "/cache/get"],
    ["cache.set", "/cache/set"],
  ])("sends %s to its fixed POST route without changing body text", async (operation, path) => {
    const input = BrowserbaseRequestParamsSchema.parse({ ...params, operation });
    const result = await executeBrowserbaseRequest(connection, input);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/services/v1${path}`,
      body: input.body,
      headers: { "content-type": "application/json", "x-bb-api-key": connection.apiKey },
    });
    if (operation !== "gateway.responses") {
      expect(requests[0].headers).not.toHaveProperty("authorization");
      expect(requests[0].headers).not.toHaveProperty("x-bb-session-id");
    }
    expect(BrowserbaseRequestResultSchema.parse(result)).toMatchObject({
      type: "response",
      status: 200,
      body: JSON.stringify(fixtures.gateway.response),
    });
  });

  it.each(fixtures.gateway.headers)("preserves Gateway $name", async ({ configured, expected }) => {
    await executeBrowserbaseRequest(
      connection,
      BrowserbaseRequestParamsSchema.parse({ ...params, headers: configured }),
    );
    expect(requests[0].headers).toMatchObject({ ...expected, "content-type": "application/json" });
  });

  it.each(fixtures.requestHeaders)(
    "applies shared request header rules: $name",
    async (fixture) => {
      for (const operation of ["gateway.responses", "cache.get", "cache.set"] as const) {
        const input = BrowserbaseRequestParamsSchema.parse({
          ...params,
          operation,
          headers: fixture.configured,
        });
        expect(await executeBrowserbaseRequest(connection, input)).toMatchObject({
          type: "response",
        });
        const received = requests.at(-1)!;
        expect(received.headers).toMatchObject({
          ...fixture.expected,
          "x-bb-api-key": connection.apiKey,
        });
        expect(received.headers.host).toBe(new URL(connection.apiUrl).host);
        expect(received.headers["content-length"]).toBe(String(Buffer.byteLength(input.body)));
        expect(received.body).toBe(input.body);
        for (const name of fixture.absent) expect(received.headers).not.toHaveProperty(name);
        expect(received.headers.connection ?? "").not.toMatch(/x-remove|x-other|authorization/i);
        expect(received.headers["x-bb-session-id"]).toBe(
          operation === "gateway.responses" ? connection.sessionId : undefined,
        );
        if (!("authorization" in fixture.expected)) {
          expect(received.headers.authorization).toBe(
            operation === "gateway.responses" ? `Bearer ${connection.apiKey}` : undefined,
          );
        }
        expect(input.headers).toEqual(fixture.configured);
      }
    },
  );

  it("preserves custom header values while replacing the cache key case-insensitively", async () => {
    await executeBrowserbaseRequest(connection, {
      ...params,
      operation: "cache.get",
      headers: {
        "X-BB-API-KEY": "custom-key",
        "X-Custom": "custom-value",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    expect(requests[0].headers).toMatchObject({
      "x-bb-api-key": connection.apiKey,
      "x-custom": "custom-value",
      "content-type": "application/json; charset=utf-8",
    });
  });

  it.each(fixtures.httpFailures)("returns $name without retrying", async (fixture) => {
    respond = (_, response) => {
      response.writeHead(fixture.status, fixture.headers);
      response.end(fixture.body);
    };
    const result = await executeBrowserbaseRequest(connection, params);
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({
      type: "response",
      status: fixture.status,
      headers: fixture.headers,
      body: fixture.body,
    });
  });

  it.each([
    fixtures.cache.get.response,
    fixtures.cache.set.response,
    ...fixtures.cache.envelopeFailures.map(({ body }) => body),
  ])("returns cache envelopes without interpreting them", async (body) => {
    respond = (_, response) => response.end(JSON.stringify(body));
    expect(
      await executeBrowserbaseRequest(connection, { ...params, operation: "cache.get" }),
    ).toMatchObject({ type: "response", status: 200, body: JSON.stringify(body) });
  });

  it("returns decoded Unicode text with usable response headers", async () => {
    const body = JSON.stringify({ title: "Café ☕", image: "x".repeat(1024 * 1024) });
    const compressed = gzipSync(body);
    respond = (_, response) => {
      response.writeHead(200, "Fixture OK", {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
        "x-request-id": "request-fixture",
      });
      response.end(compressed);
    };
    const result = await executeBrowserbaseRequest(connection, params);
    expect(result).toMatchObject({ type: "response", statusText: "Fixture OK", body });
    if (result.type !== "response") throw new Error("Expected HTTP response");
    expect(result.headers).not.toHaveProperty("content-encoding");
    expect(result.headers).not.toHaveProperty("content-length");
    expect(result.headers).toHaveProperty("x-request-id", "request-fixture");
    expect(await new Response(result.body, result).text()).toBe(body);
  });

  it("returns empty response bodies", async () => {
    respond = (_, response) => {
      response.writeHead(204);
      response.end();
    };
    expect(await executeBrowserbaseRequest(connection, params)).toMatchObject({
      type: "response",
      status: 204,
      body: "",
    });
  });

  it("classifies a reset connection without retrying", async () => {
    respond = (_, response) => response.destroy();
    expect(await executeBrowserbaseRequest(connection, params)).toEqual({
      type: "error",
      reason: "network",
      message: "Browserbase HTTP request failed",
    });
    expect(requests).toHaveLength(1);
  });

  it("classifies incomplete response bodies as network failures", async () => {
    respond = (_, response) => {
      response.writeHead(200, { "content-length": "1000" });
      response.write("partial");
      setImmediate(() => response.destroy());
    };
    expect(await executeBrowserbaseRequest(connection, params)).toMatchObject({
      type: "error",
      reason: "network",
    });
    expect(requests).toHaveLength(1);
  });

  it("returns unavailable without issuing HTTP", async () => {
    expect(await executeBrowserbaseRequest(undefined, params)).toMatchObject({
      type: "error",
      reason: "unavailable",
    });
    expect(requests).toHaveLength(0);
  });

  it.each(fixtures.invalidRequestHeaders)(
    "rejects invalid request headers: %j",
    async (headers) => {
      const input = BrowserbaseRequestParamsSchema.parse({ ...params, headers });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(executeBrowserbaseRequest(connection, input)).rejects.toEqual(
        new TypeError("Invalid Browserbase HTTP request"),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    },
  );

  it("uses a stable validation error for invalid connection headers", async () => {
    await expect(
      executeBrowserbaseRequest({ ...connection, apiKey: "invalid\nkey" }, params),
    ).rejects.toEqual(new TypeError("Invalid Browserbase HTTP request"));
    expect(requests).toHaveLength(0);
  });

  it("rejects arbitrary request destinations at the protocol boundary", async () => {
    const input = { ...params, url: redirectOrigin };
    await expect(executeBrowserbaseRequest(connection, input)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe("Browserbase HTTP deadlines", () => {
  it("honors an exhausted budget without issuing HTTP", async () => {
    expect(
      await executeBrowserbaseRequest(connection, { ...params, remainingTimeoutMs: 0 }),
    ).toMatchObject({ type: "error", reason: "timeout" });
    expect(requests).toHaveLength(0);
  });

  it.each([false, true])(
    "times out while waiting for response headers/body (headers sent: %s)",
    async (sendHeaders) => {
      respond = (_, response) => {
        if (sendHeaders) {
          response.writeHead(200);
          response.write("partial");
        }
      };
      expect(
        await executeBrowserbaseRequest(connection, { ...params, remainingTimeoutMs: 200 }),
      ).toMatchObject({ type: "error", reason: "timeout" });
      expect(requests).toHaveLength(1);
    },
  );

  it.each([new Error("caller cancelled"), new DOMException("caller deadline", "TimeoutError")])(
    "forwards caller aborts through body buffering: $name",
    async (reason) => {
      const controller = new AbortController();
      respond = (_, response) => {
        response.writeHead(200);
        response.write("partial");
      };
      const received = new Promise<void>((resolve) => {
        onRequest = resolve;
      });
      const pending = executeBrowserbaseRequest(connection, params, controller.signal);
      await received;
      controller.abort(reason);
      expect(await pending).toMatchObject({
        type: "error",
        reason: reason.name === "TimeoutError" ? "timeout" : "cancelled",
      });
    },
  );

  it("honors an already aborted caller without issuing HTTP", async () => {
    expect(await executeBrowserbaseRequest(connection, params, AbortSignal.abort())).toMatchObject({
      type: "error",
      reason: "cancelled",
    });
    expect(requests).toHaveLength(0);
  });

  it("adds no deadline when omitted and cleans up supplied timers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    await executeBrowserbaseRequest(connection, params);
    expect(vi.getTimerCount()).toBe(0);
    await executeBrowserbaseRequest(connection, { ...params, remainingTimeoutMs: 5_000 });
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(connection.apiKey);
      }),
    );
    expect(
      await executeBrowserbaseRequest(connection, { ...params, remainingTimeoutMs: 5_000 }),
    ).toEqual({ type: "error", reason: "network", message: "Browserbase HTTP request failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not shorten budgets larger than a native timer delay", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_request: Request, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = executeBrowserbaseRequest(
      connection,
      { ...params, remainingTimeoutMs: 2_147_483_648 },
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await pending).toMatchObject({ type: "error", reason: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Browserbase HTTP redirects", () => {
  it("characterizes native fetch forwarding for a different origin", async () => {
    respond = (_, response) => {
      response.writeHead(307, { location: `${redirectOrigin}/target` });
      response.end();
    };
    const response = await fetch(`${connection.apiUrl}/llm/responses`, {
      method: "POST",
      headers: { "x-bb-api-key": connection.apiKey, authorization: `Bearer ${connection.apiKey}` },
      body: params.body,
    });
    await response.text();
    expect(redirectHeaders).toHaveLength(1);
    expect(redirectHeaders[0]["x-bb-api-key"]).toBe(connection.apiKey);
    expect(redirectHeaders[0]).not.toHaveProperty("authorization");
  });

  it.each([301, 302, 303, 307, 308])("returns same-origin %s unchanged", async (status) => {
    respond = (request, response) => {
      if (request.url === "/target") {
        response.end("followed");
        return;
      }
      response.writeHead(status, { location: "/target" });
      response.end("redirect body");
    };
    expect(await executeBrowserbaseRequest(connection, params)).toMatchObject({
      type: "response",
      status,
      headers: { location: "/target" },
      body: "redirect body",
    });
    expect(requests).toHaveLength(1);
  });

  it("returns cross-origin redirects without contacting the destination", async () => {
    respond = (_, response) => {
      response.writeHead(307, { location: `${redirectOrigin}/target` });
      response.end();
    };
    expect(await executeBrowserbaseRequest(connection, params)).toMatchObject({
      type: "response",
      status: 307,
    });
    expect(redirectHeaders).toHaveLength(0);
  });
});
