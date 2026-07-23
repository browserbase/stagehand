import { describe, expect, it, vi } from "vite-plus/test";
import { resolveLocalDebuggerUrl } from "../service-worker-lifecycle/local-debugger.js";

describe("local Chromium debugger resolver", () => {
  it("extracts the browser WebSocket URL from /json/version", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/exact-session",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );

    await expect(resolveLocalDebuggerUrl({ fetchFn })).resolves.toBe(
      "ws://127.0.0.1:9222/devtools/browser/exact-session",
    );
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:9222/json/version", {
      signal: expect.any(AbortSignal),
    });
  });

  it("retries transient network failures within the resolution deadline", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/after-startup",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    await expect(resolveLocalDebuggerUrl({ fetchFn, retryIntervalMs: 0 })).resolves.toBe(
      "ws://127.0.0.1:9222/devtools/browser/after-startup",
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a debugger response that fails validation", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://browser.example/session" }), {
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(resolveLocalDebuggerUrl({ fetchFn, retryIntervalMs: 0 })).rejects.toThrow(
      "must use ws: on a loopback host",
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    "wss://127.0.0.1:9222/devtools/browser/session",
    "ws://browser.example/devtools/browser/session",
    "not a URL",
  ])("rejects a non-loopback ws debugger URL: %s", async (webSocketDebuggerUrl) => {
    await expect(
      resolveLocalDebuggerUrl({
        fetchFn: async () =>
          new Response(JSON.stringify({ webSocketDebuggerUrl }), {
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow();
  });

  it("aborts endpoint resolution after a bounded timeout", async () => {
    await expect(
      resolveLocalDebuggerUrl({
        timeoutMs: 1,
        fetchFn: async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      }),
    ).rejects.toThrow("Timed out resolving the local Chromium debugger after 1ms");
  });
});
