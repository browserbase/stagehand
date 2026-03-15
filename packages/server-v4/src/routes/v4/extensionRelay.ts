import type { FastifyInstance } from "fastify";
import WebSocket, { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";

interface InflightRequest {
  clientWs: WebSocket;
  originalId: number;
}

export function registerExtensionRelay(app: FastifyInstance): void {
  const log = app.log;

  let extensionWs: WebSocket | null = null;
  const cdpClients = new Set<WebSocket>();
  const inflightRequests = new Map<number, InflightRequest>();
  let nextRelayId = 1;

  const extensionWss = new WebSocketServer({ noServer: true });
  const cdpWss = new WebSocketServer({ noServer: true });

  // --- Extension endpoint ---
  extensionWss.on("connection", (ws: WebSocket) => {
    if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
      log.warn("New extension connection replacing existing one");
      extensionWs.close(1000, "Replaced by new connection");
    }

    extensionWs = ws;
    log.info("Extension connected to /v4/extension");

    ws.on("message", (data: WebSocket.Data) => {
      let msg: {
        id?: number;
        result?: unknown;
        error?: string;
        method?: string;
        params?: { method?: string; sessionId?: string; params?: unknown };
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        log.error("Failed to parse extension message");
        return;
      }

      if (msg.method === "forwardCDPEvent" && msg.params) {
        // CDP event from extension — broadcast to all CDP clients
        const cdpEvent: { method?: string; params?: unknown; sessionId?: string } = {
          method: msg.params.method,
          params: msg.params.params,
        };
        if (msg.params.sessionId) {
          cdpEvent.sessionId = msg.params.sessionId;
        }
        const eventStr = JSON.stringify(cdpEvent);
        for (const client of cdpClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(eventStr);
          }
        }
      } else if (msg.id !== undefined) {
        // CDP command response from extension — route to originating client
        const inflight = inflightRequests.get(msg.id);
        if (!inflight) {
          log.warn({ relayId: msg.id }, "Received response for unknown request id");
          return;
        }
        inflightRequests.delete(msg.id);

        const response: { id: number; result?: unknown; error?: { code: number; message: string } } = {
          id: inflight.originalId,
        };
        if (msg.error) {
          response.error = { code: -32000, message: msg.error };
        } else {
          response.result = msg.result ?? {};
        }

        if (inflight.clientWs.readyState === WebSocket.OPEN) {
          inflight.clientWs.send(JSON.stringify(response));
        }
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      log.info(
        { code, reason: reason.toString() },
        "Extension disconnected from /v4/extension",
      );
      if (extensionWs === ws) {
        extensionWs = null;
      }

      // Fail all inflight requests that were waiting on this extension
      for (const [relayId, inflight] of inflightRequests) {
        inflightRequests.delete(relayId);
        const errorResponse = JSON.stringify({
          id: inflight.originalId,
          error: { code: -32001, message: "Extension disconnected" },
        });
        if (inflight.clientWs.readyState === WebSocket.OPEN) {
          inflight.clientWs.send(errorResponse);
        }
      }
    });

    ws.on("error", (err: Error) => {
      log.error({ err }, "Extension WebSocket error");
    });
  });

  // --- CDP client endpoint ---
  cdpWss.on("connection", (ws: WebSocket) => {
    cdpClients.add(ws);
    log.info(
      { clientCount: cdpClients.size },
      "CDP client connected to /v4/cdp",
    );

    ws.on("message", (data: WebSocket.Data) => {
      let msg: {
        id?: number;
        method?: string;
        params?: unknown;
        sessionId?: string;
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        log.error("Failed to parse CDP client message");
        return;
      }

      if (msg.id === undefined || !msg.method) {
        log.warn("CDP client message missing id or method");
        return;
      }

      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        // No extension connected — respond with error
        const errorResponse = JSON.stringify({
          id: msg.id,
          error: { code: -32000, message: "No extension connected" },
        });
        ws.send(errorResponse);
        return;
      }

      const relayId = nextRelayId++;
      inflightRequests.set(relayId, {
        clientWs: ws,
        originalId: msg.id,
      });

      const wrappedCommand: {
        id: number;
        method: string;
        params: { method: string; params?: unknown; sessionId?: string };
      } = {
        id: relayId,
        method: "forwardCDPCommand",
        params: {
          method: msg.method,
          params: msg.params,
        },
      };
      if (msg.sessionId) {
        wrappedCommand.params.sessionId = msg.sessionId;
      }

      extensionWs.send(JSON.stringify(wrappedCommand));
    });

    ws.on("close", (code: number, reason: Buffer) => {
      cdpClients.delete(ws);
      log.info(
        { code, reason: reason.toString(), clientCount: cdpClients.size },
        "CDP client disconnected from /v4/cdp",
      );

      // Clean up any inflight requests for this client
      for (const [relayId, inflight] of inflightRequests) {
        if (inflight.clientWs === ws) {
          inflightRequests.delete(relayId);
        }
      }
    });

    ws.on("error", (err: Error) => {
      log.error({ err }, "CDP client WebSocket error");
    });
  });

  // --- Attach to Fastify's HTTP server via upgrade event ---
  app.addHook("onReady", () => {
    const server = app.server;

    server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const url = new URL(request.url ?? "", `http://${request.headers.host}`);
      const pathname = url.pathname;

      if (pathname === "/v4/extension") {
        extensionWss.handleUpgrade(request, socket, head, (ws) => {
          extensionWss.emit("connection", ws, request);
        });
      } else if (pathname === "/v4/cdp") {
        cdpWss.handleUpgrade(request, socket, head, (ws) => {
          cdpWss.emit("connection", ws, request);
        });
      }
      // If neither path matches, let other handlers (or Fastify) deal with it
    });

    log.info("Extension relay WebSocket endpoints registered (/v4/extension, /v4/cdp)");
  });
}
