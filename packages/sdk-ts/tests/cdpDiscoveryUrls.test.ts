import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { resolveBrowserWebSocketUrl } from "../src/cdpClient.js";

describe("CDP discovery URL components", () => {
  it.each([
    ["", "/json/version"],
    ["/?token=first%2Fsecond&token=third", "/json/version?token=first%2Fsecond&token=third"],
    ["/proxy/?token=value", "/proxy/json/version?token=value"],
    ["/proxy#local-fragment", "/proxy/json/version"],
    ["/proxy/?token=value#local-fragment", "/proxy/json/version?token=value"],
  ])("discovers a browser through %s", async (suffix, expectedPath) => {
    const requests: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url !== expectedPath) {
        response.writeHead(401);
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ webSocketDebuggerUrl: "ws://browser.example/debugger" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    try {
      await expect(
        resolveBrowserWebSocketUrl(`http://127.0.0.1:${address.port}${suffix}`, {
          signal: AbortSignal.timeout(1_000),
        }),
      ).resolves.toBe("ws://browser.example/debugger");
      expect(requests).toEqual([expectedPath]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
