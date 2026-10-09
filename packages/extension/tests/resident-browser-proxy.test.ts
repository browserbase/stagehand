import { describe, expect, it, vi } from "vitest";
import {
  ResidentBrowserProxyError,
  resolveResidentBrowserWebSocketUrl,
} from "../service-worker-lifecycle/resident-browser-proxy.js";

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; json?: () => Promise<unknown> } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: init.json ?? (async () => body),
  } as Response;
}

describe("resident browser proxy resolver", () => {
  it("resolves Chromium and preserves the exact browser target path and query", async () => {
    const fetch = vi.fn(async () =>
      response({
        webSocketDebuggerUrl:
          "ws://127.0.0.1:9222/devtools/browser/a%2Fb?token=one%2Ftwo&token=three",
      }),
    );

    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", { fetch }),
    ).resolves.toBe("ws://127.0.0.1:9333/devtools/browser/a%2Fb?token=one%2Ftwo&token=three");
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:9333/json/version"),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("uses secure WebSockets for an HTTPS proxy and supports default ports", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("https://127.0.0.1", {
        fetch: async () =>
          response({
            webSocketDebuggerUrl: "ws://localhost/devtools/browser/browser-id?token=one",
          }),
      }),
    ).resolves.toBe("wss://127.0.0.1/devtools/browser/browser-id?token=one");
  });

  it("accepts a secure upstream WebSocket for an HTTPS proxy", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("https://127.0.0.1", {
        fetch: async () =>
          response({
            webSocketDebuggerUrl: "wss://127.0.0.1:9224/devtools/browser/browser-id?token=one",
          }),
      }),
    ).resolves.toBe("wss://127.0.0.1/devtools/browser/browser-id?token=one");
  });

  it("rejects a secure upstream WebSocket for an HTTP proxy", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9224", {
        fetch: async () =>
          response({
            webSocketDebuggerUrl: "wss://127.0.0.1:9222/devtools/browser/id",
          }),
      }),
    ).rejects.toThrow("must use ws:");
  });

  it("preserves an identity rewrite from the proxy", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9224", {
        fetch: async () =>
          response({
            webSocketDebuggerUrl: "ws://127.0.0.1:9224/devtools/browser/browser-id",
          }),
      }),
    ).resolves.toBe("ws://127.0.0.1:9224/devtools/browser/browser-id");
  });

  it("accepts an IPv6 loopback upstream", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9224", {
        fetch: async () =>
          response({
            webSocketDebuggerUrl: "ws://[::1]:9222/devtools/browser/browser-id",
          }),
      }),
    ).resolves.toBe("ws://127.0.0.1:9224/devtools/browser/browser-id");
  });

  it("rejects malformed JSON", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof globalThis.fetch;

    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", { fetch }),
    ).rejects.toThrow("Unexpected token");
  });

  it.each([
    [{}, "webSocketDebuggerUrl"],
    [{ webSocketDebuggerUrl: "http://127.0.0.1:9222/devtools/browser/id" }, "must use ws:"],
    [{ webSocketDebuggerUrl: "ws://browser.example:9222/devtools/browser/id" }, "loopback"],
    [{ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/id" }, "browser target"],
    [{ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/id/" }, "browser target"],
    [{ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/id#frag" }, "fragment"],
  ])("rejects invalid version metadata %#", async (body, message) => {
    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
        fetch: async () => response(body),
      }),
    ).rejects.toThrow(message);
  });

  it("reports rejected fetches as unavailable", async () => {
    const result = resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(result).rejects.toMatchObject({ code: "RESIDENT_PROXY_UNAVAILABLE" });
    await expect(result).rejects.toThrow(/RESIDENT_PROXY_UNAVAILABLE.*extensions/);
  });

  it("reports a bounded timeout as unavailable", async () => {
    const fetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        await new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason), {
            once: true,
          });
        }),
    );

    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", { fetch, timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: "RESIDENT_PROXY_UNAVAILABLE" });
  });

  it("reports an origin rejection as forbidden", async () => {
    const result = resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
      fetch: async () => response({ error: "forbidden" }, { ok: false, status: 403 }),
    });

    await expect(result).rejects.toMatchObject({
      code: "RESIDENT_PROXY_FORBIDDEN",
      status: 403,
    });
  });

  it.each(["stagehand_not_enabled", "browser_unavailable"])(
    "reports HTTP 503 with %s as not ready",
    async (error) => {
      const result = resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
        fetch: async () => response({ error }, { ok: false, status: 503 }),
      });

      await expect(result).rejects.toMatchObject({
        code: "RESIDENT_PROXY_NOT_READY",
        status: 503,
      });
      await expect(result).rejects.toThrow(error);
    },
  );

  it("keeps an unknown HTTP failure as a plain error when its body is not JSON", async () => {
    const error = await resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
      fetch: async () =>
        response(undefined, {
          ok: false,
          status: 500,
          json: async () => {
            throw new SyntaxError("not JSON");
          },
        }),
    }).catch((reason: unknown) => reason);

    expect(error).toEqual(new Error("Browser proxy version request failed with HTTP 500"));
    expect(error).not.toBeInstanceOf(ResidentBrowserProxyError);
  });

  it("reports a known readiness body on another HTTP status as not ready", async () => {
    await expect(
      resolveResidentBrowserWebSocketUrl("http://127.0.0.1:9333", {
        fetch: async () => response({ error: "browser_unavailable" }, { ok: false, status: 502 }),
      }),
    ).rejects.toMatchObject({
      code: "RESIDENT_PROXY_NOT_READY",
      status: 502,
    });
  });

  it.each([
    "ws://127.0.0.1:9333",
    "http://browser.example:9333",
    "http://127.0.0.1:9333/path",
    "http://user:secret@127.0.0.1:9333",
  ])("rejects invalid proxy configuration %s", async (browserProxyUrl) => {
    await expect(resolveResidentBrowserWebSocketUrl(browserProxyUrl)).rejects.toThrow();
  });
});
