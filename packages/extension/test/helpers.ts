/**
 * Test helpers for the Stagehand extension E2E tests.
 *
 * Launches Chrome with the extension loaded and remote debugging enabled,
 * connects via CDP WebSocket, and provides utilities for test assertions.
 */

import { launch, type LaunchedChrome } from "chrome-launcher";
import WebSocket from "ws";
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
 * Build Chrome proxy flags from environment variables.
 * Disabled: Chrome in Docker can't use the JWT-auth proxy. Tests use a local server.
 */
function getProxyFlags(): string[] {
  return [];
}

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
 * Returns the LaunchedChrome instance and the CDP WebSocket URL.
 */
export async function launchChromeWithExtension(opts?: {
  headless?: boolean;
}): Promise<{ chrome: LaunchedChrome; wsUrl: string; port: number }> {
  const headless = opts?.headless ?? true;

  // Chrome flags for extension loading + remote debugging
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
    ...getProxyFlags(),
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
 * Used for testing stagehand library connecting to a running Chrome.
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
    ...getProxyFlags(),
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

  async send(method: string, params?: object): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
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
 * Used because Chrome in Docker can't reach external URLs through the proxy.
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
