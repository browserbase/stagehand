/**
 * Test helpers for the Stagehand extension E2E tests.
 *
 * Launches Chrome with the extension loaded and remote debugging enabled,
 * connects via CDP WebSocket, starts a minimal relay server that mimics
 * the server-v4 /v4/extension + /v4/cdp WebSocket endpoints, and provides
 * utilities for test assertions.
 */

import { launch, type LaunchedChrome } from "chrome-launcher";
import WebSocket, { WebSocketServer } from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer, type Server } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CHROMIUM_PATH =
  process.env.CHROME_PATH ||
  "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";

export const EXTENSION_DIST = resolve(__dirname, "..", "dist");

/**
 * Wait for a WebSocket debugger URL from Chrome's /json/version endpoint.
 */
async function waitForWsUrl(port: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) {
        const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
        if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      }
    } catch {
      // Not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for CDP on port ${port}`);
}

/**
 * Launch Chrome with the extension loaded and remote debugging enabled.
 */
export async function launchChromeWithExtension(opts?: {
  headless?: boolean;
}): Promise<{ chrome: LaunchedChrome; wsUrl: string; port: number }> {
  const headless = opts?.headless ?? true;

  const chromeFlags = [
    headless ? "--headless=new" : "",
    `--disable-extensions-except=${EXTENSION_DIST}`,
    `--load-extension=${EXTENSION_DIST}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ].filter(Boolean);

  const chrome = await launch({
    chromePath: CHROMIUM_PATH,
    chromeFlags,
    connectionPollInterval: 250,
    maxConnectionRetries: 60,
  });

  const wsUrl = await waitForWsUrl(chrome.port);
  return { chrome, wsUrl, port: chrome.port };
}

/**
 * Launch a plain Chrome instance with remote debugging (no extension).
 */
export async function launchChrome(): Promise<{
  chrome: LaunchedChrome;
  wsUrl: string;
  port: number;
}> {
  const chromeFlags = [
    "--headless=new",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
  ];

  const chrome = await launch({
    chromePath: CHROMIUM_PATH,
    chromeFlags,
    connectionPollInterval: 250,
    maxConnectionRetries: 60,
  });

  const wsUrl = await waitForWsUrl(chrome.port);
  return { chrome, wsUrl, port: chrome.port };
}

/**
 * Minimal CDP client over WebSocket for test assertions.
 */
export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private eventHandlers = new Map<string, Array<(params: unknown) => void>>();
  private ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (e) => reject(e));
    });

    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if ("id" in msg) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if ("method" in msg) {
        const handlers = this.eventHandlers.get(msg.method);
        if (handlers) handlers.forEach((h) => h(msg.params));
      }
    });
  }

  async connect(): Promise<void> {
    await this.ready;
  }

  async send(method: string, params?: object, sessionId?: string): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: Record<string, unknown> = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    const list = this.eventHandlers.get(event) || [];
    list.push(handler);
    this.eventHandlers.set(event, list);
  }

  async close(): Promise<void> {
    this.ws.close();
    await new Promise<void>((r) => this.ws.once("close", () => r()));
  }
}

/**
 * Get the list of open pages/targets from Chrome's /json endpoint.
 */
export async function getTargets(
  port: number
): Promise<Array<{ id: string; url: string; type: string; webSocketDebuggerUrl?: string }>> {
  const resp = await fetch(`http://127.0.0.1:${port}/json`);
  return (await resp.json()) as Array<{
    id: string;
    url: string;
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const EXAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Example Domain</title></head>
<body>
<div>
  <h1>Example Domain</h1>
  <p>This domain is for use in illustrative examples in documents.
  You may use this domain in literature without prior coordination or asking for permission.</p>
  <p><a href="https://www.iana.org/domains/example">More information...</a></p>
</div>
</body>
</html>`;

/**
 * Start a local HTTP server serving example.com-like HTML.
 */
export async function startTestServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(EXAMPLE_HTML);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Navigate a target to a URL via CDP and wait for load.
 */
export async function navigateAndWait(
  client: CdpClient,
  url: string,
  timeoutMs = 15_000
): Promise<void> {
  await client.send("Page.enable");
  const loadPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Navigation to ${url} timed out`)),
      timeoutMs
    );
    client.on("Page.loadEventFired", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await client.send("Page.navigate", { url });
  await loadPromise;
}

/**
 * Evaluate a JS expression in the page and return the result.
 */
export async function evaluate(
  client: CdpClient,
  expression: string
): Promise<unknown> {
  const result = (await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result: { value?: unknown; type: string; description?: string };
    exceptionDetails?: { text: string };
  };

  if (result.exceptionDetails) {
    throw new Error(`Eval failed: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

// ──────────────────────────────────────────────────────────
// Minimal CDP Relay Server (mirrors server-v4 extensionRelay.ts)
// ──────────────────────────────────────────────────────────

interface InflightRequest {
  clientWs: WebSocket;
  originalId: number;
}

/**
 * Start a minimal WebSocket relay server that mimics the server-v4
 * /v4/extension and /v4/cdp endpoints.
 *
 * This allows tests to verify the full flow:
 * stagehand client → /v4/cdp → relay → /v4/extension → extension → chrome.debugger → page
 */
export async function startRelayServer(port = 0): Promise<{
  server: Server;
  port: number;
  waitForExtension: (timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
}> {
  let extensionWs: WebSocket | null = null;
  const cdpClients = new Set<WebSocket>();
  const inflightRequests = new Map<number, InflightRequest>();
  let nextRelayId = 1;
  let extensionConnectedResolve: (() => void) | null = null;

  const extensionWss = new WebSocketServer({ noServer: true });
  const cdpWss = new WebSocketServer({ noServer: true });

  // Extension endpoint
  extensionWss.on("connection", (ws: WebSocket) => {
    if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
      extensionWs.close(1000, "Replaced");
    }
    extensionWs = ws;
    console.log("[relay] Extension connected");

    if (extensionConnectedResolve) {
      extensionConnectedResolve();
      extensionConnectedResolve = null;
    }

    ws.on("message", (data) => {
      let msg: {
        id?: number;
        result?: unknown;
        error?: string;
        method?: string;
        params?: { method?: string; sessionId?: string; params?: unknown };
      };
      try {
        msg = JSON.parse(data.toString());
      } catch { return; }

      if (msg.method === "forwardCDPEvent" && msg.params) {
        // Broadcast CDP event to all clients
        const cdpEvent: Record<string, unknown> = {
          method: msg.params.method,
          params: msg.params.params,
        };
        if (msg.params.sessionId) cdpEvent.sessionId = msg.params.sessionId;
        const eventStr = JSON.stringify(cdpEvent);
        for (const client of cdpClients) {
          if (client.readyState === WebSocket.OPEN) client.send(eventStr);
        }
      } else if (msg.id !== undefined) {
        // Route response to originating client
        const inflight = inflightRequests.get(msg.id);
        if (!inflight) return;
        inflightRequests.delete(msg.id);

        const response: Record<string, unknown> = { id: inflight.originalId };
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

    ws.on("close", () => {
      if (extensionWs === ws) extensionWs = null;
      console.log("[relay] Extension disconnected");
      for (const [relayId, inflight] of inflightRequests) {
        inflightRequests.delete(relayId);
        if (inflight.clientWs.readyState === WebSocket.OPEN) {
          inflight.clientWs.send(JSON.stringify({
            id: inflight.originalId,
            error: { code: -32001, message: "Extension disconnected" },
          }));
        }
      }
    });
  });

  // CDP client endpoint
  cdpWss.on("connection", (ws: WebSocket) => {
    cdpClients.add(ws);
    console.log("[relay] CDP client connected");

    ws.on("message", (data) => {
      let msg: { id?: number; method?: string; params?: unknown; sessionId?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch { return; }

      if (msg.id === undefined || !msg.method) return;

      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: msg.id,
          error: { code: -32000, message: "No extension connected" },
        }));
        return;
      }

      const relayId = nextRelayId++;
      inflightRequests.set(relayId, { clientWs: ws, originalId: msg.id });

      const wrapped: Record<string, unknown> = {
        id: relayId,
        method: "forwardCDPCommand",
        params: { method: msg.method, params: msg.params },
      };
      if (msg.sessionId) {
        (wrapped.params as Record<string, unknown>).sessionId = msg.sessionId;
      }
      extensionWs.send(JSON.stringify(wrapped));
    });

    ws.on("close", () => {
      cdpClients.delete(ws);
      for (const [relayId, inflight] of inflightRequests) {
        if (inflight.clientWs === ws) inflightRequests.delete(relayId);
      }
    });
  });

  // HTTP server for WebSocket upgrade
  const httpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    if (url.pathname === "/v4/extension") {
      extensionWss.handleUpgrade(request, socket, head, (ws) => {
        extensionWss.emit("connection", ws, request);
      });
    } else if (url.pathname === "/v4/cdp") {
      cdpWss.handleUpgrade(request, socket, head, (ws) => {
        cdpWss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  return new Promise((resolve) => {
    httpServer.listen(port, "127.0.0.1", () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : 0;
      console.log(`[relay] Listening on port ${actualPort}`);

      resolve({
        server: httpServer,
        port: actualPort,
        waitForExtension: (timeoutMs = 15_000) => {
          if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
            return Promise.resolve();
          }
          return new Promise<void>((res, rej) => {
            const timer = setTimeout(
              () => rej(new Error("Timed out waiting for extension to connect")),
              timeoutMs
            );
            extensionConnectedResolve = () => {
              clearTimeout(timer);
              res();
            };
          });
        },
        close: async () => {
          for (const client of cdpClients) client.close();
          extensionWs?.close();
          extensionWss.close();
          cdpWss.close();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
      });
    });
  });
}
