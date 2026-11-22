import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CdpConnection, resolveWebSocketEndpoint } from "../../core/tools/cdp_code.js";

const evalsRequire = createRequire(import.meta.url);

type WsClient = {
  close: () => void;
};

type WsServer = {
  clients: Set<WsClient>;
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsClient) => void,
  ) => void;
  close: (callback?: () => void) => void;
};

type WsServerConstructor = new (options: { noServer: boolean }) => WsServer;

const { WebSocketServer } = evalsRequire("ws") as {
  WebSocketServer: WsServerConstructor;
};

type TestCdpServer = {
  httpUrl: string;
  wsUrl: string;
  discoveryHeaders: IncomingHttpHeaders[];
  upgradeHeaders: IncomingHttpHeaders[];
  close: () => Promise<void>;
};

async function startAuthCdpServer(options?: {
  requiredAuth?: string;
  requiredApiKey?: string;
}): Promise<TestCdpServer> {
  const requiredAuth = options?.requiredAuth ?? "Bearer secret";
  const requiredApiKey = options?.requiredApiKey;
  const discoveryHeaders: IncomingHttpHeaders[] = [];
  const upgradeHeaders: IncomingHttpHeaders[] = [];
  const wss = new WebSocketServer({ noServer: true });
  let wsUrl = "";

  const isAuthorized = (headers: IncomingHttpHeaders): boolean =>
    headers.authorization === requiredAuth &&
    (requiredApiKey === undefined || headers["x-api-key"] === requiredApiKey);

  const server: Server = createServer((req, res) => {
    if (req.url !== "/json/version") {
      res.writeHead(404);
      res.end();
      return;
    }

    discoveryHeaders.push(req.headers);
    if (!isAuthorized(req.headers)) {
      res.writeHead(401, "Unauthorized", { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ webSocketDebuggerUrl: wsUrl }));
  });

  server.on("upgrade", (req, socket, head) => {
    upgradeHeaders.push(req.headers);
    if (!isAuthorized(req.headers)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const httpUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/devtools/browser/test`;

  return {
    httpUrl,
    wsUrl,
    discoveryHeaders,
    upgradeHeaders,
    close: async () => {
      for (const client of wss.clients) {
        client.close();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

describe("CDP HTTP endpoint discovery and connection headers", () => {
  const servers: TestCdpServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it("rejects HTTP discovery with 401 when required auth headers are omitted", async () => {
    const server = await startAuthCdpServer();
    servers.push(server);

    await expect(resolveWebSocketEndpoint({ kind: "http", url: server.httpUrl })).rejects.toThrow(
      /401 Unauthorized/,
    );

    expect(server.discoveryHeaders).toHaveLength(1);
    expect(server.discoveryHeaders[0]?.authorization).toBeUndefined();
  });

  it("forwards configured headers during HTTP discovery and skips fetch for ws endpoints", async () => {
    const server = await startAuthCdpServer({ requiredApiKey: "test-key" });
    servers.push(server);

    const resolved = await resolveWebSocketEndpoint({
      kind: "http",
      url: server.httpUrl,
      headers: {
        Authorization: "Bearer secret",
        "X-Api-Key": "test-key",
      },
    });

    expect(resolved).toBe(server.wsUrl);
    expect(server.discoveryHeaders).toHaveLength(1);
    expect(server.discoveryHeaders[0]?.authorization).toBe("Bearer secret");
    expect(server.discoveryHeaders[0]?.["x-api-key"]).toBe("test-key");

    const directWs = await resolveWebSocketEndpoint({
      kind: "ws",
      url: server.wsUrl,
      headers: { Authorization: "Bearer secret" },
    });
    expect(directWs).toBe(server.wsUrl);
    expect(server.discoveryHeaders).toHaveLength(1);
  });

  it("forwards headers on both HTTP discovery and WebSocket upgrade in CdpConnection.connect", async () => {
    const server = await startAuthCdpServer({ requiredApiKey: "test-key" });
    servers.push(server);

    const connection = await CdpConnection.connect({
      kind: "http",
      url: server.httpUrl,
      headers: {
        Authorization: "Bearer secret",
        "X-Api-Key": "test-key",
      },
    });

    try {
      expect(server.discoveryHeaders).toHaveLength(1);
      expect(server.discoveryHeaders[0]?.authorization).toBe("Bearer secret");
      expect(server.discoveryHeaders[0]?.["x-api-key"]).toBe("test-key");

      expect(server.upgradeHeaders).toHaveLength(1);
      expect(server.upgradeHeaders[0]?.authorization).toBe("Bearer secret");
      expect(server.upgradeHeaders[0]?.["x-api-key"]).toBe("test-key");
    } finally {
      await connection.close();
    }
  });
});
