import { describe, expect, it, vi } from "vitest";
import { createBrowserbaseApiClient } from "../src/browserbaseClient.js";

describe("Browserbase API client", () => {
  it("uses web-standard requests and validates Browserbase responses", async () => {
    const requests: Request[] = [];
    const fetchBrowserbase = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request =
        input instanceof Request && init === undefined ? input : new Request(input, init);
      requests.push(request);
      const { pathname } = new URL(request.url);

      if (request.method === "POST" && pathname === "/v1/extensions") {
        return jsonResponse({ id: "ext_stagehand", ignored: "field" });
      }
      if (request.method === "DELETE" && pathname === "/v1/extensions/ext_stagehand") {
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && pathname === "/v1/sessions") {
        return jsonResponse({
          id: "session_123",
          connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          ignored: "field",
        });
      }
      if (request.method === "GET" && pathname === "/v1/sessions/session_123") {
        return jsonResponse({
          id: "session_123",
          connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          region: "us-west-2",
          ignored: "field",
        });
      }
      if (request.method === "POST" && pathname === "/v1/sessions/session_123") {
        return jsonResponse({ id: "session_123", status: "COMPLETED" });
      }

      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch;
    const client = createBrowserbaseApiClient("bb_key", {
      baseUrl: "https://api.browserbase.test",
      fetch: fetchBrowserbase,
    });

    await expect(client.uploadExtension(new Blob(["zip"]))).resolves.toStrictEqual({
      id: "ext_stagehand",
    });
    await expect(client.createSession({ region: "us-west-2" })).resolves.toStrictEqual({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    });
    await expect(client.retrieveSession("session_123")).resolves.toStrictEqual({
      id: "session_123",
      connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "us-west-2",
    });
    await client.releaseSession("session_123");
    await client.deleteExtension("ext_stagehand");

    expect(fetchBrowserbase).toHaveBeenCalledTimes(5);
    for (const request of requests) {
      expect(request.headers.get("X-BB-API-Key")).toBe("bb_key");
    }

    const extensionForm = await requests[0]!.clone().formData();
    const extensionFile = extensionForm.get("file");
    expect(extensionFile).toBeInstanceOf(Blob);
    expect((extensionFile as File).name).toBe("stagehand-extension.zip");
    expect(await (extensionFile as Blob).text()).toBe("zip");
    await expect(requests[1]!.clone().json()).resolves.toStrictEqual({
      region: "us-west-2",
    });
    expect(requests[2]!.method).toBe("GET");
    expect(requests[2]!.headers.get("Content-Type")).toBeNull();
    await expect(requests[3]!.clone().json()).resolves.toStrictEqual({
      status: "REQUEST_RELEASE",
    });
    expect(requests[4]!.headers.get("Content-Type")).toBeNull();
  });

  it("rejects invalid Browserbase responses through the Zod schema", async () => {
    const client = createBrowserbaseApiClient("bb_key", {
      baseUrl: "https://api.browserbase.test",
      fetch: async () => jsonResponse({ id: "session_123" }),
    });

    await expect(client.createSession({})).rejects.toMatchObject({ kind: "validation" });
  });

  it.each([
    ["an HTTP URL", "https://connect.browserbase.com/devtools/browser/session_123"],
    ["a relative URL", "/devtools/browser/session_123"],
    ["a malformed URL", "not a URL"],
  ])("rejects %s as a Browserbase connection URL", async (_description, connectUrl) => {
    const client = createBrowserbaseApiClient("bb_key", {
      baseUrl: "https://api.browserbase.test",
      fetch: async () => jsonResponse({ id: "session_123", connectUrl }),
    });

    await expect(client.createSession({})).rejects.toMatchObject({ kind: "validation" });
  });

  it("accepts a local WebSocket Browserbase connection URL", async () => {
    const connectUrl = "ws://localhost:9222/devtools/browser/session_123";
    const client = createBrowserbaseApiClient("bb_key", {
      baseUrl: "https://api.browserbase.test",
      fetch: async () => jsonResponse({ id: "session_123", connectUrl }),
    });

    await expect(client.createSession({})).resolves.toStrictEqual({
      id: "session_123",
      connectUrl,
    });
  });

  it("validates retrieved Browserbase session data", async () => {
    const client = createBrowserbaseApiClient("bb_key", {
      baseUrl: "https://api.browserbase.test",
      fetch: async () =>
        jsonResponse({
          id: "session_123",
          connectUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          region: "moon-1",
        }),
    });

    await expect(client.retrieveSession("session_123")).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("requires a Browserbase API key before issuing requests", () => {
    expect(() => createBrowserbaseApiClient(" ")).toThrow("API key is required");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
