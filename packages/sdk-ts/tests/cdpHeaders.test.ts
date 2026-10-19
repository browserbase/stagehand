import { createServer, type IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { CDPClient } from "../src/cdpClient.js";

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
