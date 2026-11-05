import Browserbase, { APIConnectionTimeoutError } from "@browserbasehq/sdk";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialFetch, sdkCredentialFetch } from "../src/lib/auth/credentials.js";
import { createBrowserbaseClient, requestBrowserbase } from "../src/lib/cloud/api.js";
import { functionsRequest, resolveFunctionsApiConfig } from "../src/lib/functions/shared.js";

const credential = {
  apiKey: "synthetic-saved-key",
  baseUrl: "https://api.browserbase.com",
  source: "saved" as const,
};
const url = `${credential.baseUrl}/v1/projects`;
function savedClient(options: { maxRetries?: number; timeout?: number } = {}) {
  return new Browserbase({
    apiKey: credential.apiKey,
    fetch: sdkCredentialFetch(credential),
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("saved credential transport compatibility", () => {
  it("honors SDK retry refusal while redacting the response", async () => {
    const request = vi.fn().mockImplementation(
      async () =>
        new Response(credential.apiKey, {
          status: 503,
          headers: { "x-should-retry": "false", "retry-after": "37" },
        }),
    );
    vi.stubGlobal("fetch", request);
    const error = await savedClient()
      .projects.list()
      .catch((error: unknown) => error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      status: 503,
      headers: { "x-should-retry": "false", "retry-after": "37" },
    });
    expect(JSON.stringify(error)).not.toContain(credential.apiKey);
  });

  it.each([
    [{ "retry-after-ms": "125", "retry-after": "9" }, 125],
    [{ "retry-after": "0.125" }, 125],
    [{ "retry-after": "Thu, 01 Jan 2026 00:00:01 GMT" }, 1_000],
  ])("preserves the SDK retry delay for %j", async (headers, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(credential.apiKey, {
          status: 400,
          headers: { ...headers, "x-should-retry": "true" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("[]", { headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", request);
    const result = savedClient({ maxRetries: 1 }).projects.list();
    const completed = result.then((projects) => projects);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await completed).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("discards arbitrary reflected error headers and invalid retry values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(credential.apiKey, {
          status: 401,
          headers: {
            "x-should-retry": credential.apiKey,
            "retry-after": credential.apiKey,
            "retry-after-ms": `1 ${credential.apiKey}`,
            "x-request-id": credential.apiKey,
          },
        }),
      ),
    );
    const error = await savedClient({ maxRetries: 0 })
      .projects.list()
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ headers: { "content-type": "application/json" } });
    expect(JSON.stringify(error)).not.toContain(credential.apiKey);
  });

  it("preserves SDK timeout classification without retaining the original error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          (_input, init: RequestInit) =>
            new Promise((_resolve, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException(credential.apiKey, "AbortError")),
              ),
            ),
        ),
    );
    const result = savedClient({ maxRetries: 0, timeout: 5 }).projects.list();
    await expect(result).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    await expect(result).rejects.toThrow("Request timed out.");
  });

  it.each(["AbortError", "TimeoutError", "Error"])(
    "sanitizes %s messages and causes",
    async (name) => {
      const error = new Error(credential.apiKey, { cause: new Error(credential.apiKey) });
      error.name = name;
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      const result = await credentialFetch(credential)(url).catch((failure: unknown) => failure);
      expect(result).toBeInstanceOf(Error);
      expect(String(result)).not.toContain(credential.apiKey);
      expect((result as Error).cause).toBeUndefined();
      if (name !== "Error") expect((result as Error).name).toBe(name);
    },
  );
});

describe("explicit API keys retain their existing transports", () => {
  it.each(["flag", "environment"])(
    "keeps the SDK transport and redirects for %s keys",
    async (source) => {
      const server = createServer((request, response) => {
        if (request.url === "/v1/projects") {
          response.writeHead(302, { location: "/projects-result" }).end();
        } else {
          response.writeHead(200, { "content-type": "application/json" }).end("[]");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        // The SDK's original Node transport does not use globalThis.fetch.
        const nativeFetch = vi.fn().mockRejectedValue(new Error("Unexpected native fetch"));
        vi.stubGlobal("fetch", nativeFetch);
        vi.stubEnv("BROWSERBASE_API_KEY", "synthetic-explicit-key");
        const client = createBrowserbaseClient({
          ...(source === "flag" ? { apiKey: "synthetic-explicit-key" } : {}),
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        });
        expect(await client.projects.list()).toEqual([]);
        expect(nativeFetch).not.toHaveBeenCalled();
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("keeps cloud and Functions fetch options and error messages for explicit keys", async () => {
    const request = vi
      .fn()
      .mockImplementation(async () => new Response("original server error", { status: 400 }));
    vi.stubGlobal("fetch", request);
    const args = { apiKey: "synthetic-explicit-key" };
    await expect(requestBrowserbase(args, "/v1/projects")).rejects.toThrow("original server error");
    await expect(
      functionsRequest(resolveFunctionsApiConfig(args), "/v1/functions"),
    ).rejects.toThrow("original server error");
    for (const call of request.mock.calls) expect(call[1]).not.toHaveProperty("redirect");
  });
});
