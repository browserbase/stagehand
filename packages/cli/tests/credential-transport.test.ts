import Browserbase, { APIConnectionTimeoutError } from "@browserbasehq/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialFetch, sdkCredentialFetch } from "../src/lib/auth/credentials.js";

const credential = {
  apiKey: "synthetic-saved-key",
  baseUrl: "https://api.browserbase.com",
  source: "saved" as const,
};
const url = `${credential.baseUrl}/v1/projects`;
function savedClient(options: { maxRetries?: number } = {}) {
  return new Browserbase({
    apiKey: credential.apiKey,
    fetch: sdkCredentialFetch(credential),
    ...options,
  });
}

afterEach(() => {
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
    { "retry-after-ms": "125", "retry-after": "9" },
    { "retry-after": "0.125" },
    { "retry-after": "Thu, 01 Jan 2026 00:00:01 GMT" },
  ])("preserves safe retry hints when redacting a response with %j", async (headers) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(credential.apiKey, {
          status: 400,
          headers: { ...headers, "x-should-retry": "true" },
        }),
      ),
    );
    const response = await credentialFetch(credential)(url);
    expect(response.status).toBe(400);
    expect(response.headers.get("x-should-retry")).toBe("true");
    for (const [name, value] of Object.entries(headers)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(await response.text()).not.toContain(credential.apiKey);
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
      vi.fn().mockRejectedValue(new DOMException(credential.apiKey, "AbortError")),
    );
    const error = await savedClient({ maxRetries: 0 })
      .projects.list()
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(APIConnectionTimeoutError);
    expect(String(error)).not.toContain(credential.apiKey);
    expect(String((error as Error).cause)).not.toContain(credential.apiKey);
    expect(JSON.stringify(error)).not.toContain(credential.apiKey);
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
