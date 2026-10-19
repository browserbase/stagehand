import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { CDPClient, canForwardCDPHeaders, resolveBrowserWebSocketUrl } from "../src/cdpClient.js";

describe.each<Record<string, string> | undefined>([
  undefined,
  {},
  { Authorization: "Bearer test-token", "X-Api-Key": "test-key" },
])("CDP headers %j", (headers) => {
  it.each(["http", "ws"])("forwards headers through a %s connection", async (scheme) => {
    const discoveryRequests: IncomingHttpHeaders[] = [];
    const handshakeRequests: IncomingHttpHeaders[] = [];
    let endpoint = "";
    const server = createServer((request, response) => {
      discoveryRequests.push(request.headers);
      expect(request.url).toBe("/json/version");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://${endpoint}/browser` }));
    });
    server.on("upgrade", (request, socket) => {
      handshakeRequests.push(request.headers);
      // Stop before extension discovery; the real WebSocket handshake reached the server.
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    endpoint = `127.0.0.1:${address.port}`;
    try {
      await expect(
        CDPClient.connect({
          cdpUrl: `${scheme}://${endpoint}${scheme === "ws" ? "/browser" : ""}`,
          headers,
          extensionId: "test-extension",
          signal: AbortSignal.timeout(2_000),
        }),
      ).rejects.toThrow("Failed to open CDP WebSocket");
      expect(discoveryRequests).toHaveLength(scheme === "http" ? 1 : 0);
      expect(handshakeRequests).toHaveLength(1);
      for (const request of [...discoveryRequests, ...handshakeRequests]) {
        expect(request.authorization).toBe(headers?.Authorization);
        expect(request["x-api-key"]).toBe(headers?.["X-Api-Key"]);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("CDP credential boundaries", () => {
  it.each([
    ["https://gw", "wss://gw:443/browser", true],
    ["http://gw", "ws://gw:80/browser", true],
    ["http://gw:443", "wss://gw/browser", true],
    ["https://gw", "ws://gw:443/browser", false],
    ["https://gw", "wss://other/browser", false],
    ["https://gw", "wss://gw:9443/browser", false],
    ["https://gw", "file://gw/browser", false],
    ["bad-url", "wss://gw/browser", false],
  ] as const)("checks %s -> %s", (source, destination, allowed) => {
    expect(canForwardCDPHeaders(source, destination)).toBe(allowed);
  });

  it.each(["wss://other/browser", "wss://gw:9443/browser", "ws://gw:443/browser"])(
    "withholds headers from %s and emits a safe diagnostic",
    async (destination) => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ webSocketDebuggerUrl: destination })),
      );
      const socket = vi.fn(function () {
        throw new Error("stop before connecting");
      });
      const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.stubEnv("STAGEHAND_CDP_LOG", "1");
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("WebSocket", socket);
      try {
        await expect(
          CDPClient.connect({
            cdpUrl: "https://gw?token=secret-url",
            headers: { "X-Secret": "secret-value" },
            signal: AbortSignal.timeout(1000),
          }),
        ).rejects.toThrow("stop before connecting");
        expect(socket).toHaveBeenCalledWith(destination);
        expect(log).toHaveBeenCalledOnce();
        const diagnostic = String(log.mock.calls[0]?.[0]);
        expect(diagnostic).toContain("headers were withheld");
        for (const secret of [destination, "secret-url", "secret-value", "X-Secret"]) {
          expect(diagnostic).not.toContain(secret);
        }
      } finally {
        log.mockRestore();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );

  it.each([401, 403])("fails immediately and safely on HTTP %s", async (status) => {
    for (const headers of [undefined, {}, { "X-Secret": "secret-value" }] as (
      | Record<string, string>
      | undefined
    )[]) {
      const fetchFn = vi.fn(
        async () => new Response("secret-body", { status, statusText: "secret-reason" }),
      );
      const delayFn = vi.fn(async () => {});
      const result = resolveBrowserWebSocketUrl("https://gw?token=secret-url", {
        headers,
        fetchFn,
        delayFn,
        signal: AbortSignal.timeout(1000),
      });
      await expect(result).rejects.toThrow(`CDP discovery was rejected with HTTP ${status}`);
      await expect(result).rejects.not.toThrow(/secret/);
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(delayFn).not.toHaveBeenCalled();
    }
  });

  it.each([429, 500, 503, "network"])("retries transient failure %s", async (status) => {
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async () => {
        if (status === "network") throw new Error("connection refused");
        return new Response(null, { status: Number(status) });
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ webSocketDebuggerUrl: "wss://gw/browser" })),
      );
    const delayFn = vi.fn(async () => {});
    await expect(
      resolveBrowserWebSocketUrl("https://gw", {
        headers: { "X-Key": "value" },
        fetchFn,
        delayFn,
        signal: AbortSignal.timeout(1000),
      }),
    ).resolves.toBe("wss://gw/browser");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledOnce();
  });

  it.each(["https://other/secret", "https://gw:9443/secret", "http://gw:443/secret"])(
    "rejects unsafe discovery redirect %s before requesting it",
    async (location) => {
      const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(
        resolveBrowserWebSocketUrl("https://gw", {
          headers: { "X-Key": "secret" },
          fetchFn,
          signal: AbortSignal.timeout(1000),
        }),
      ).rejects.toThrow("Refusing CDP HTTP redirect");
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(fetchFn).toHaveBeenCalledWith(
        "https://gw/json/version",
        expect.objectContaining({ redirect: "manual" }),
      );
    },
  );

  it("limits redirect loops", async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    await expect(
      resolveBrowserWebSocketUrl("https://gw", {
        headers: { "X-Key": "secret" },
        fetchFn,
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow("Too many CDP HTTP redirects");
    expect(fetchFn).toHaveBeenCalledTimes(21);
  });
});

async function withServer(server: Server, run: (base: string) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("CDP redirects over the network", () => {
  it.each([true, false])(
    "follows same-origin discovery redirects, headers=%s",
    async (authenticated) => {
      const seen: (string | undefined)[] = [];
      const server = createServer((request, response) => {
        seen.push(request.headers["x-api-key"] as string | undefined);
        if (request.url === "/json/version") {
          response.writeHead(302, { location: "/final" });
          response.end();
        } else {
          response.end(JSON.stringify({ webSocketDebuggerUrl: "ws://gw/browser" }));
        }
      });
      await withServer(server, async (base) => {
        await expect(
          resolveBrowserWebSocketUrl(base, {
            headers: authenticated ? { "X-Api-Key": "secret" } : undefined,
            signal: AbortSignal.timeout(1000),
          }),
        ).resolves.toBe("ws://gw/browser");
        expect(seen).toEqual(authenticated ? ["secret", "secret"] : [undefined, undefined]);
      });
    },
  );

  it.each<Record<string, string> | undefined>([undefined, {}, { "X-Api-Key": "secret" }])(
    "guards cross-port discovery redirects, headers=%j",
    async (headers) => {
      const received: IncomingHttpHeaders[] = [];
      const destination = createServer((request, response) => {
        received.push(request.headers);
        response.end(JSON.stringify({ webSocketDebuggerUrl: "ws://gw/browser" }));
      });
      await withServer(destination, async (target) => {
        const source = createServer((_request, response) => {
          response.writeHead(302, { location: `${target}/final` });
          response.end();
        });
        await withServer(source, async (base) => {
          const result = resolveBrowserWebSocketUrl(base, {
            headers,
            signal: AbortSignal.timeout(1000),
          });
          if (headers && Object.keys(headers).length) {
            await expect(result).rejects.toThrow("Refusing CDP HTTP redirect");
            expect(received).toHaveLength(0);
          } else {
            await expect(result).resolves.toBe("ws://gw/browser");
            expect(received).toHaveLength(1);
          }
        });
      });
    },
  );

  it("does not forward credentials on a WebSocket redirect", async () => {
    const received: IncomingHttpHeaders[] = [];
    const destination = createServer();
    destination.on("upgrade", (request, socket) => {
      received.push(request.headers);
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    });
    await withServer(destination, async (target) => {
      const original: IncomingHttpHeaders[] = [];
      const source = createServer();
      source.on("upgrade", (request, socket) => {
        original.push(request.headers);
        socket.end(
          `HTTP/1.1 302 Found\r\nLocation: ${target.replace("http:", "ws:")}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
      await withServer(source, async (base) => {
        await expect(
          CDPClient.connect({
            cdpUrl: base.replace("http:", "ws:"),
            headers: { "X-Api-Key": "secret" },
            signal: AbortSignal.timeout(1000),
          }),
        ).rejects.toThrow("Failed to open CDP WebSocket");
        expect(original).toHaveLength(1);
        expect(original[0]?.["x-api-key"]).toBe("secret");
        expect(received).toHaveLength(0);
      });
    });
  });
});
